import assert from 'node:assert/strict';import {generateWarpingYarnIssueNo,validateYarnSettlement} from './manufacturingYarnIssueService.js';
const client={query:async(sql:string)=>sql.includes('MAX(')?{rows:[{max_seq:'4'}]}:{rows:[]}} as never;
assert.equal(await generateWarpingYarnIssueNo(client,'c1'),'YI-0000005');assert.equal(validateYarnSettlement({issued:10,returned:2,waste:1}),null);assert.ok(validateYarnSettlement({issued:10,returned:9,waste:2}));
console.log('manufacturingYarnIssueService tests passed');
