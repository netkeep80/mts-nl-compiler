import assert from "node:assert/strict";
import {test} from "node:test";
import {ObservedPairAgenda,fullScanPairLeader}
 from "../src/observed-pair-agenda-e5.mjs";
import {analyzeLateSymbolRevision} from "../src/late-revision-e4.mjs";

const before="ab".repeat(6000)+"cd".repeat(6000)+"c";
const oldFragment="ab".repeat(128);
test("E5 append one char, one pair inspection, and re-evaluate old watch 23k positions back",()=>{
 const agenda=new ObservedPairAgenda(before);
 const initial=agenda.leader;
 assert.deepEqual(initial,{a:"a",b:"b",count:6000});
 const old=agenda.trackRange("old",0,[...oldFragment].length);
 const irrelevant=agenda.trackRange("unrelated",11999,2); // boundary "bc"
 assert.equal(agenda.decode(old.root),oldFragment);
 assert.equal(agenda.decode(irrelevant.root),"bc");
 const beforeCost=agenda.reachableCost();
 const out=agenda.append("d",{eventId:"ext:t24002"});
 assert.equal(out.selectedChanged,true);
 assert.deepEqual(out.current,{a:"c",b:"d",count:6001});
 assert.equal(out.inspectedNewAdjacentPositions,1);
 assert.equal(out.invalidated,1); // "bc" contains neither old nor new pair
 const limit=agenda.processPending({maxWatchers:0});
 assert.equal(limit.status,"RESOURCE_LIMIT");
 assert.equal(limit.remaining,1);
 const update=agenda.processPending({maxWatchers:1});
 assert.equal(update.status,"QUIESCENT");
 assert.equal(update.processed,1);
 assert.equal(update.modified[0].id,"old");
 assert.equal(update.modified[0].changed,true);
 assert.ok(update.modified[0].distanceFromFront>10000);
 assert.equal(agenda.decode(agenda.watches.get("old").root),oldFragment);
 assert.equal(agenda.watches.get("unrelated").root,irrelevant.root);
 const cost=agenda.reachableCost();
 const retained=agenda.reachableCost({retained:true});
 assert.ok(retained.uniqueDuplets>=cost.uniqueDuplets);
 assert.equal(agenda.snapshot().work.appendAdjacentInspections,1);
 assert.equal(agenda.snapshot().work.probeCodepointsReevaluated,256);
 assert.equal(agenda.snapshot().work.initialAdjacentInspections,[...before].length-1);
 assert.equal(agenda.snapshot().work.externalAppends,1);
 assert.equal(agenda.snapshot().sourceLength,[...before].length+1);
 const oracle=analyzeLateSymbolRevision({before,receivedSymbol:"d",
  oldFragment,maxRounds:1});
 assert.equal(oracle.revision.rootChanged,true);
 assert.equal(agenda.watches.get("old").versions[0].root,oracle.before.oldProbeRoot);
 assert.equal(agenda.watches.get("old").root,oracle.after.oldProbeRoot);
 assert.equal(out.current.a,"c");
 assert.equal(out.current.b,"d");
 console.log("E5_INCREMENTAL_LATE_FRONTIER "+JSON.stringify({
  initialSelected:initial,finalSelected:out.current,
  distance: update.modified[0].distanceFromFront,
  newAdjacentPositionsInspected:out.inspectedNewAdjacentPositions,
  oldFragmentPositionsReevaluated:agenda.snapshot().work.probeCodepointsReevaluated,
  sourceLength:agenda.snapshot().sourceLength,
  affectedWatchers:out.invalidated,
  oldRootChanged:update.modified[0].changed,
  selectedBefore:beforeCost,selectedAfter:cost,retained,
  oracleSelectedRootsEqual:true,
  fullSourceGraphIncrementalRebuild:"NOT_IMPLEMENTED",
  nativeGamma:"NOT_EXECUTED"
 }));
});
test("E5 selected rule counts equal full-rescan oracle after each streaming Unicode symbol",()=>{
 const input="мама мама🏁éе\u0308ABABab☀️cadab";
 const s=new ObservedPairAgenda();
 for(const [i,ch] of [...input].entries()){
  const x=s.append(ch,{eventId:"e:"+i});
  assert.equal(x.inspectedNewAdjacentPositions,i===0?0:1);
  assert.deepEqual(s.leader,fullScanPairLeader([...input].slice(0,i+1).join("")));
 }
 assert.equal(s.snapshot().work.appendAdjacentInspections,[...input].length-1);
 assert.equal(s.snapshot().work.externalAppends,[...input].length);
});
test("E5 repeated event ID cannot inflate pair statistics or independent observed count",()=>{
 const s=new ObservedPairAgenda("abab");
 const first=s.append("a",{eventId:"e5"});
 const prior=s.snapshot(),counts=s.pairCounts();
 const repeated=s.append("a",{eventId:"e5"});
 assert.equal(first.status,"OBSERVATION_APPLIED");
 assert.equal(repeated.status,"REPLAY_NOOP");
 assert.deepEqual(s.pairCounts(),counts);
 assert.equal(s.snapshot().externalAppends,prior.externalAppends);
 assert.equal(s.snapshot().sourceSha256,prior.sourceSha256);
 assert.throws(()=>s.append("b",{eventId:"e5"}),/contradictory replay/);
});
test("E5 scope guards: Unicode, ranges, limit and observed/proof boundaries",()=>{
 assert.throws(()=>new ObservedPairAgenda("\ud800"),/invalid source/);
 const s=new ObservedPairAgenda("xyzxyz");
 assert.throws(()=>s.append("\ud800",{eventId:"bad"}),/Unicode scalar/);
 assert.throws(()=>s.append("ab",{eventId:"bad"}),/Unicode scalar/);
 assert.throws(()=>s.append("a"),/external event ID/);
 assert.throws(()=>s.trackRange("missing",40,1),/bad\/duplicate watch/);
 s.trackRange("old",0,3);
 assert.throws(()=>s.trackRange("old",0,3),/bad\/duplicate watch/);
 assert.throws(()=>s.processPending({maxWatchers:-1}),/bad watcher budget/);
});
test("E5 incremental source top 1 is independent of tracked probe counts",()=>{
 const s=new ObservedPairAgenda("abcabca");
 const leader=s.leader;
 const c0=s.pairCounts();
 for(let i=0;i<40;i++)s.trackRange("probe:"+i,0,3);
 assert.deepEqual(s.leader,leader);
 assert.deepEqual(s.pairCounts(),c0);
 assert.equal(s.snapshot().work.externalAppends,0);
});
