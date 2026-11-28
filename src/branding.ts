/**
 * Single source of truth for the project's brand identity.
 *
 * الهوية البصرية الجديدة (نوفمبر 2026): الشعار متجه في src/assets/brand/clotex-mark-{purple,white,black}.svg
 * ومنه نُسخت: logo.png (بنفسجي)، logo-thermal.png (أسود للحراري واللصاقة)، public/clotex-logo.png (أيقونة)، logo-white.png (للخلفيات الداكنة).
 * الألوان مستخرجة من التصاميم المعتمدة.
 */

import brandMarkUrl from '../logo.png?url';
import brandMarkInline from '../logo.png?inline';
import brandMarkThermalInline from '../logo-thermal.png?inline';
import brandMarkWhiteInline from './assets/brand/logo-white.png?inline';

export const BRAND = {
  /** Primary product/brand mark (the big word in the logo). */
  name: 'CLOTEX',
  /** Tagline directly under the mark on the logo. */
  tagline: 'CLOTHES TEXTILE',
  /** Long product name used in installers, window titles, etc. */
  fullName: 'CLOTEX — Clothes Textile',
  /** Short Arabic descriptor used as a subtitle/description. */
  descriptionAr: 'نظام إدارة مستودعات الأقمشة',
  /** Long English descriptor used in metadata and installers. */
  descriptionEn: 'CLOTEX — Clothes Textile Warehouse ERP',
  /** Brand color tokens (matches the navy in the logo image). */
  primaryColor: '#4C3890',
  primaryColorSoft: '#7060A4',
  /** الذهبي الثانوي (خط الفاصل في الترويسات). */
  accentColor: '#B89854',
  /** سطر الشعار في ترويسة المطبوعات. */
  taglineDocs: 'Textile Industry Solutions',
  /** Resolved asset URLs (Vite `?url` — works with Electron `file://` and `base: './'). */
  /** الموقع الرسمي — هدف QR لصاقة الكارتيلة (عدّله هنا فقط). */
  websiteUrl: 'https://www.clotexco.com',
  logoPng: brandMarkUrl,
  /** Inline data URI for print/PDF HTML contexts where file URLs may fail. */
  logoInline: brandMarkInline,
  /** Black-on-transparent logo for thermal label/sticker printing (no CSS filter). */
  logoThermalInline: brandMarkThermalInline,
  /** نسخة بيضاء للخلفيات الداكنة (تسجيل الدخول). */
  logoWhiteInline: brandMarkWhiteInline,
  logoSvg: brandMarkUrl,
  /** Copyright holder shown in footers. */
  copyrightHolder: 'CLOTEX',
} as const;

export type Brand = typeof BRAND;
