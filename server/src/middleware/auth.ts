import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from './errorHandler.js';
import { touchActiveSession, isSessionRevoked } from '../services/activeSessionsService.js';
import { clientIp } from '../utils/clientIp.js';
import { effectivePermissionsForUser } from '../services/userPermissionService.js';
import { ACTION_LABELS, resolveRoutePolicy } from '../services/permissionCatalog.js';
import { findApprovedGrant } from '../services/editRequestService.js';

export type JwtPayload = {
  sub: string;
  companyId: string;
  username: string;
  role: string;
  permissions: string[];
  /** مدير منصة حقيقي (مالك نظام clotex) — منفصل عن "أدمن" أي شركة عميل. */
  isPlatformAdmin: boolean;
  /** يُملأ بالحارس فقط (غير موقَّع بالتوكن): صلاحيات المصفوفة الفعلية لمن بوضع «مخصّص». */
  matrix?: string[];
  customPerms?: boolean;
};

export function signAuthToken(payload: JwtPayload): string {
  const env = getEnv();
  const secret: Secret = env.JWT_SECRET;
  const signOpts = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions;
  return jwt.sign(
    {
      sub: payload.sub,
      companyId: payload.companyId,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions,
      isPlatformAdmin: payload.isPlatformAdmin,
    },
    secret,
    signOpts,
  );
}

export function verifyAuthToken(token: string): JwtPayload {
  const env = getEnv();
  const secret: Secret = env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  const p = decoded as unknown as JwtPayload;
  if (
    typeof p.sub !== 'string' ||
    typeof p.companyId !== 'string' ||
    typeof p.username !== 'string' ||
    typeof p.role !== 'string' ||
    !Array.isArray(p.permissions)
  ) {
    throw new Error('invalid_token_payload');
  }
  // متساهل عمداً: توكنات صادرة قبل إضافة هذا الحقل لا تحمله — تُعامل كـ false
  // (أضيق صلاحية) بدل رفض الجلسة بالكامل.
  p.isPlatformAdmin = p.isPlatformAdmin === true;
  return p;
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
  }

  try {
    const payload = verifyAuthToken(token);
    const pool = getPool();
    // بحث واحد بمفتاح id (PK، مفهرس أصلاً) يجلب كل ما يلزم: الحالة، الاسم،
    // الشركة الأصلية، وحالة "مدير المنصة" — تُقرأ من قاعدة البيانات مباشرة
    // بكل طلب، لا تُؤخذ من التوكن.
    const userCheck = await pool.query<{
      is_active: boolean;
      full_name: string | null;
      company_id: string;
      is_platform_admin: boolean;
      role: string;
      perm_mode: string;
    }>(
      'SELECT is_active, full_name, company_id, is_platform_admin, role, perm_mode FROM users WHERE id = $1',
      [payload.sub],
    );
    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
      return sendError(reply, 401, ArabicErrors.userInactive, 'UNAUTHORIZED');
    }

    // التوكن يمثّل شركة غير الشركة الأصلية للمستخدم (بعد switch-company) —
    // هذا لا يُسمح به إلا لمدير منصة ما زال فعّالاً *الآن*، وليس وقت إصدار
    // التوكن. مدير منصة أُلغيت صلاحيته يفقد الوصول لحسابات الآخرين فوراً،
    // بدل انتظار انتهاء صلاحية التوكن.
    if (payload.companyId !== userCheck.rows[0].company_id && !userCheck.rows[0].is_platform_admin) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }

    if (isSessionRevoked(payload.sub, token)) {
      return sendError(reply, 401, 'تم إنهاء الجلسة من قبل المدير', 'SESSION_REVOKED');
    }

    // وضع الصلاحيات «مخصّص»: تُقرأ المصفوفة من القاعدة بكل طلب (فيسري أي تعديل فوراً) وتُطبَّق مركزياً على كل المسارات.
    if (userCheck.rows[0].perm_mode === 'CUSTOM' && payload.role !== 'admin') {
      const eff = await effectivePermissionsForUser(pool, { id: payload.sub, role: payload.role, perm_mode: 'CUSTOM' });
      payload.permissions = eff.permissions;
      payload.matrix = eff.matrix;
      payload.customPerms = true;
      const policy = resolveRoutePolicy(request.routeOptions?.url ?? request.url.split('?')[0], request.method);
      // استثناء واحد: إذن تعديل معتمد (x-edit-request) لهذا العنصر بالذات يسمح بمرة تعديل بلا صلاحية «تعديل» بالمصفوفة.
      let grantOk = false;
      const grantHeader = String(request.headers['x-edit-request'] ?? '').trim();
      const m = request.method.toUpperCase();
      if (policy && !policy.open && !eff.matrix.includes(policy.code) && grantHeader && (m === 'PUT' || m === 'PATCH')) {
        const entityId = String((request.params as { id?: string } | undefined)?.id ?? '');
        if (await findApprovedGrant(pool, payload.companyId, payload.sub, grantHeader, entityId)) {
          grantOk = true;
          request.editGrantId = grantHeader;
        }
      }
      if (policy && !policy.open && !eff.matrix.includes(policy.code) && !grantOk) {
        return sendError(reply, 403, `ليست لديك صلاحية «${ACTION_LABELS[policy.action]}» في «${policy.module.name}»`, 'FORBIDDEN');
      }
    }

    request.user = payload;
    request.authToken = token;
    touchActiveSession({
      payload,
      token,
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] || '—'),
      clientPlatformHeader: request.headers['x-client-platform'],
      fullName: userCheck.rows[0].full_name,
    });
  } catch {
    return sendError(reply, 401, ArabicErrors.tokenInvalid, 'UNAUTHORIZED');
  }
}

/**
 * إدارة الحسابات (companies) وتراخيص كل الحسابات تخص مالك منصة clotex فقط
 * — وليست صلاحية "أدمن" عادية، لأن "أدمن" موجود بكل حساب على حدة ولا يجوز
 * أن يرى أو يتحكم بحسابات/تراخيص حسابات أخرى.
 */
/** هل يملك المستخدم إجراءً بوحدة؟ المدير ومن بوضع الدور (الافتراضي) غير مقيَّدين بالمصفوفة. */
export function userCan(user: JwtPayload | undefined, moduleCode: string, action: string): boolean {
  if (!user) return false;
  if (user.role === 'admin' || !user.customPerms) return true;
  return (user.matrix ?? []).includes(`p:${moduleCode}.${action}`);
}

/**
 * حق التسعير/الترحيل المالي بوحدة (فواتير بيع/شراء…): المدير دائماً؛ بوضع «مخصّص» من مُنح «تسعير» (أو «اعتماد» إن لم تُعرَّف «تسعير» للوحدة)؛
 * وبوضع الدور: المحاسب والمدير التشغيلي فقط. الباقون (مخزون/مشاهد…) يحفظون مسودات بلا أسعار يسعّرها المحاسب لاحقاً.
 */
export function canPrice(user: JwtPayload | undefined, moduleCode: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.customPerms) {
    const m = user.matrix ?? [];
    return m.includes(`p:${moduleCode}.price`) || m.includes(`p:${moduleCode}.approve`);
  }
  return user.role === 'accountant' || user.role === 'manager';
}

/** تعديل مباشر بلا إذن: المدير/المحاسب/المدير التشغيلي بالدور؛ وبالمصفوفة من مُنح «تعديل» للوحدة. */
export function canEditDirect(user: JwtPayload | undefined, moduleCode: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.customPerms) return (user.matrix ?? []).includes(`p:${moduleCode}.edit`);
  return user.role === 'accountant' || user.role === 'manager';
}

/** الاطلاع على الأمور المالية لطرف (كشف حساب/أرصدة): المدير؛ بالمصفوفة من مُنح «عرض المالية» (costView)؛ وبالدور المحاسب والمدير التشغيلي. */
export function canSeeFinance(user: JwtPayload | undefined, moduleCode: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.customPerms) return (user.matrix ?? []).includes(`p:${moduleCode}.costView`);
  return user.role === 'accountant' || user.role === 'manager';
}

/**
 * حارس مسارات التعديل: مسموح لمن يملك التعديل المباشر، أو لمن معه إذن معتمد (ترويسة x-edit-request) لهذا العنصر.
 * الإذن يُستهلك تلقائياً بعد نجاح الطلب (hook بالتطبيق). يرجع false بعد إرسال 403 برمز EDIT_APPROVAL_REQUIRED.
 */
export async function requireEditOrGrant(request: FastifyRequest, reply: FastifyReply, moduleCode: string, entityId: string): Promise<boolean> {
  const user = request.user;
  if (canEditDirect(user, moduleCode)) return true;
  const grant = String(request.headers['x-edit-request'] ?? '').trim();
  if (user && grant && (await findApprovedGrant(getPool(), user.companyId, user.sub, grant, entityId))) {
    request.editGrantId = grant;
    return true;
  }
  sendError(reply, 403, 'التعديل يحتاج إذن المسؤول — اطلب الإذن أولاً', 'EDIT_APPROVAL_REQUIRED');
  return false;
}

export function requirePlatformAdmin(user: JwtPayload | undefined): boolean {
  return Boolean(user?.isPlatformAdmin);
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
    authToken?: string;
    /** إذن تعديل معتمد استُعمل بهذا الطلب (يُستهلك عند النجاح). */
    editGrantId?: string;
  }
}
