import i18n from '../i18n/config';

/**
 * ترجمة نصوص ستيكر الأتواب خارج مكوّنات React (دالة بناء مستند الطباعة).
 *
 * العيب الذي صُحِّح: كان buildPrintDocument يستدعي i18n.t('labelCard.itemNameLabel') بلا مجال ترجمة،
 * فيبحث بالمجال الافتراضي common ويرجع المفتاح الخام نصاً — فتُطبع لصاقة مليئة بـ
 * "labelCard.itemNameLabel" ونصوص طويلة متراكبة. المفاتيح موجودة بمجال labelCard، فيجب تحديده صراحة.
 */
export function labelT(key: string): string {
  return i18n.t(key, { ns: 'labelCard' });
}
