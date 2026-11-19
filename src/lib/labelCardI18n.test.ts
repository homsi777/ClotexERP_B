/**
 * ملاحظة مدير بشير: الستيكر «ملخبط» — كان يطبع مفاتيح الترجمة الخام (labelCard.itemNameLabel…).
 * السبب: i18n.t بلا مجال ترجمة. هذا الاختبار يثبّت أن المفاتيح تُحَلّ بالعربية والتركية، وأن ملف الستيكر
 * لا يعود لاستدعاء i18n.t المباشر بمفاتيح labelCard.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import i18n from '../i18n/config';
import { labelT } from './labelCardI18n';

const KEYS = [
  'labelCard.itemNameLabel',
  'labelCard.materialCodeLabel',
  'labelCard.colorNameLabel',
  'labelCard.colorCodeLabel',
  'labelCard.qualityLabel',
  'labelCard.noteLabel',
  'labelCard.batchNumberLabel',
  'labelCard.metersLabel',
  'labelCard.netWeightLabel',
  'labelCard.defaultDisclaimer',
];

async function main() {
  for (const lng of ['ar', 'tr']) {
    await i18n.changeLanguage(lng);
    for (const k of KEYS) {
      const v = labelT(k);
      assert.notEqual(v, k, `${lng}: المفتاح ${k} لم يُترجَم (يرجع خاماً)`);
      assert.ok(!v.startsWith('labelCard.'), `${lng}: ${k} → ${v}`);
    }
  }
  await i18n.changeLanguage('ar');
  assert.equal(labelT('labelCard.itemNameLabel'), 'رمز الصنف');

  // حارس: لا عودة لـ i18n.t('labelCard.…') المباشر بملف الستيكر
  const src = fs.readFileSync(new URL('../components/labels/LabelCard.tsx', import.meta.url), 'utf8');
  assert.ok(!/i18n\.t\(\s*['"]labelCard\./.test(src), 'LabelCard.tsx يستدعي i18n.t بلا مجال ترجمة');
  console.log('labelCardI18n tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
