import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {executionInput,executionRuntime,validateExecution} from './manufacturingExecutionService.js';

const base={operation:'DAILY_LOG',requestId:randomUUID(),version:1,productionDate:'2026-11-20',
 shiftTypeId:randomUUID(),machineId:randomUUID(),lengthM:10,
 workers:[{employeeId:randomUUID(),minutes:480},{employeeId:randomUUID(),minutes:480}],
 downtimes:[{reasonId:randomUUID(),minutes:15},{reasonId:randomUUID(),minutes:5}],notes:'Actual execution'};
const daily=(extra:Record<string,unknown>={})=>{
 const d=executionInput.parse({...base,...extra});
 if(d.operation!=='DAILY_LOG')throw new Error('Expected daily log');
 return d;
};

test('legacy daily log has no inferred runtime or timestamps',()=>{
 const d=daily();validateExecution('WARPING',d);
 assert.equal(executionRuntime(d),undefined);
 assert.equal('startedAt' in d,false);assert.equal('endedAt' in d,false);
});
test('machine runtime uses the measured interval minus stops, independently of labor minutes',()=>{
 const d=daily({startedAt:'2026-11-20T08:00',endedAt:'2026-11-20T09:00'});
 validateExecution('SIZING',d);
 assert.deepEqual(executionRuntime(d),{durationMinutes:60,runtimeMinutes:40});
 assert.equal(d.workers.reduce((sum,w)=>sum+w.minutes,0),960);
 assert.deepEqual(executionRuntime(daily({startedAt:'2026-11-20T08:00:30',endedAt:'2026-11-20T08:20:30'})),{durationMinutes:20,runtimeMinutes:0});
});
test('actual times require a complete, increasing pair within the production day',()=>{
 for(const times of [
  {startedAt:'2026-11-20T08:00'}, {endedAt:'2026-11-20T09:00'},
  {startedAt:'2026-11-20T09:00',endedAt:'2026-11-20T08:00'},
  {startedAt:'2026-11-20T08:00',endedAt:'2026-11-20T08:00'},
  {startedAt:'2026-11-19T08:00',endedAt:'2026-11-20T09:00'},
  {startedAt:'2026-11-20T23:00',endedAt:'2026-11-21T01:00'},
  {startedAt:'2026-11-19T08:00',endedAt:'2026-11-19T09:00'},
  {startedAt:'2026-11-20T08:00',endedAt:'2026-11-20T08:19:59'},
 ])assert.throws(()=>validateExecution('WARPING',daily(times)));
});
test('invalid wall times, dates, zones and client-computed runtime are rejected',()=>{
 for(const startedAt of ['2026-11-20T24:00','2026-11-20T08:60','2026-11-20T08:00:60','2026-02-30T08:00','2026-11-20T08:00Z','2026-11-20T08:00+02:00','08:00',''])
  assert.equal(executionInput.safeParse({...base,startedAt,endedAt:'2026-11-20T09:00'}).success,false);
 assert.equal(executionInput.safeParse({...base,runtimeMinutes:99}).success,false);
});
