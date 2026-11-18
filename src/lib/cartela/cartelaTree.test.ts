/** TASK 010 — اختبار groupCartelasByFabric: تجميع بالاسم، اختلاف الدسان، وحساسية الحروف/المسافات. */
import assert from 'node:assert/strict';
import { groupCartelasByFabric } from './cartelaTree';

const items = [
  { id: '1', title: 'Muslin', art_code: 'D-10' },
  { id: '2', title: ' muslin ', art_code: 'D-2' },
  { id: '3', title: 'Muslin', art_code: 'd-10' },
  { id: '4', title: 'Satin', art_code: 'S-1' },
  { id: '5', title: '', art_code: '' },
];

function testSameFabricNameDifferentDesignCodesShareOneNode() {
  const tree = groupCartelasByFabric(items);
  const muslin = tree.find((f) => f.key === 'muslin');
  assert.ok(muslin);
  assert.equal(muslin.cartelaCount, 3);
  assert.equal(muslin.designs.length, 2, 'D-10 وd-10 دسان واحد؛ D-2 دسان آخر');
}

function testDesignsSortedNaturallyAndFabricsSorted() {
  const tree = groupCartelasByFabric(items);
  const muslin = tree.find((f) => f.key === 'muslin')!;
  assert.deepEqual(muslin.designs.map((d) => d.artCode), ['D-2', 'D-10']);
  const titles = tree.map((f) => f.title);
  assert.deepEqual([...titles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), titles);
}

function testEmptyTitleAndCodeKeepCartelaVisible() {
  const tree = groupCartelasByFabric(items);
  const blank = tree.find((f) => f.key === '');
  assert.ok(blank);
  assert.equal(blank.designs[0].cartelas[0].id, '5', 'لا تُخفى كارتيلة بلا اسم');
}

function testEveryCartelaAppearsExactlyOnce() {
  const tree = groupCartelasByFabric(items);
  const ids = tree.flatMap((f) => f.designs.flatMap((d) => d.cartelas.map((c) => c.id))).sort();
  assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
}

testSameFabricNameDifferentDesignCodesShareOneNode();
testDesignsSortedNaturallyAndFabricsSorted();
testEmptyTitleAndCodeKeepCartelaVisible();
testEveryCartelaAppearsExactlyOnce();
console.log('cartelaTree tests passed');
