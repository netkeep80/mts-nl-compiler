import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runS0Corpus} from '../src/w19-semantic-s0.mjs';

const paths={
 fixture:new URL('../tests/fixtures/w19-s0-requirements-v0.json',import.meta.url),
 definitions:new URL('../tests/fixtures/w19-s0-definitions-v0.json',import.meta.url),
 engine:new URL('../src/w19-semantic-s0.mjs',import.meta.url)
};
const raw=Object.fromEntries(Object.entries(paths).map(([k,u])=>[k,readFileSync(u)]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=JSON.parse(raw.fixture.toString('utf8'));
const pack=JSON.parse(raw.definitions.toString('utf8'));
const run=runS0Corpus(fixture.examples,pack);
const stable=x=>{
  if(x===null||typeof x!=='object')return JSON.stringify(x);
  if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
  return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
};
const cases=run.cases.map(c=>{
  const source=fixture.examples.find(x=>x.id===c.id);
  const actual=c.B.link;
  const provisionalExact=source.provisional.status===actual.status&&
    (source.provisional.status!=='PROPOSED'||
      stable(source.provisional.relation)===stable(actual.candidates[0]?.relation));
  return {
    id:c.id,family:source.family,text:c.text,contextId:c.contextId,
    sourceUtf8Bytes:Buffer.byteLength(c.text,'utf8'),
    provisional:{
      status:source.provisional.status,review:source.provisional.review,
      annotationSpans:source.provisional.spans,
      diagnosticAgreementOnlyNotAccuracy:provisionalExact
    },
    A:{
      status:c.A.balanced.status,
      observedTokens:c.A.balanced.observed.tokens,
      sourceGraph:c.A.balanced.observed.sourceGraph,
      semanticCandidates:[]
    },
    B:{
      status:actual.status,
      candidates:actual.candidates,
      flatStatus:c.B.flat.status,
      linkEqualsFlat:c.invariants.linkEqualsFlatAtSameKnowledge,
      binaryizationInvariant:c.invariants.binaryizationSemanticInvariant
    },
    C:{
      status:c.C.link.status,
      contextId:c.C.contextId,
      removedDefinitionIds:c.C.removedDefinitionIds,
      candidates:c.C.link.candidates
    }
  };
});
const provisionalMismatches=cases.filter(x=>!x.provisional.diagnosticAgreementOnlyNotAccuracy).map(x=>x.id);
const report={
  schema:'mts-nl/W19S0/machine-protocol/v0',
  status:'RESEARCH_REPLAY_COMPLETE',
  baseMain:'cba8ee4baa9724ae124da68c469f20c35c8789c7',
  sourceDigests:{
    corpusSha256:sha(raw.fixture),
    definitionPackSha256:sha(raw.definitions),
    engineSha256:sha(raw.engine)
  },
  priorResearch:{
    B0:'#92: same observations => Link context prediction equals n-gram',
    B1:'#93: structure can propose unseen combinations but semantic licitness is nonidentifiable',
    W23:'#107: physical representation objectives are separate from meaning'
  },
  annotationPolicy:{
    engineReceivesProvisionalAnnotation:false,
    independentGold:false,
    accuracyMetrics:'NOT_SCORED_NO_INDEPENDENT_GOLD',
    provisionalAgreementIsOnlyFixtureConsistency:true
  },
  metrics:{...run.metrics,provisionalDiagnosticMismatches:provisionalMismatches},
  cases
};
console.log('W19S0_REPORT '+JSON.stringify(report));
