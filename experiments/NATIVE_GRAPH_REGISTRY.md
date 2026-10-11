# Native one-ANet registry: arbitrary identity preservation (#26)

This research carrier encodes any **finite** source `links` table (including duplicate pole-pair identities and cycles) in **ordinary native MTS Links** using accepted `Memory`, `StringAnum` and `ExactSequence` from pinned `anum_docs`. It does not replace the actual primitive link `(from,to)` with an arbitrary host model, nor claim that transport wrapper identities are native semantic identities. It is an **invertible graph transport**, not an accepted FORMAL compilation path.

Each source Link ID becomes a native row anchor `namespace -> StringAnum(UTF8(ID))`, with explicit role-marked Link edges for optional `string`, optional `weight`, and both or neither `from/to`. Poles refer to **row anchors allocated first**, so self/mutual cycles and same-poles distinct IDs are preserved. The entire selected registry is a native self-closed ExactSequence of anchors. The reader decodes only those native structures, follows the selected role edges and reconstructs all five authoritative fields. Cached `from_uses`/`to_uses` remain derived. None of the role markers here is a new semantic primitive or a license to activate logical implications.

Native UTF-8 StringAnum is read back byte-exactly (no Unicode normalization). The roundtrip preserves empty labels, composed/decomposed characters, mixed scripts, formulas, `weight:null` (absent role) versus `weight:0` (explicit role), parallel Links and cyclic poles, selected sequence trees by rebuilding from `$links`.

The exact-pinned upstream CI performs independent negative checks (duplicate role detection; resource cap), verifies stable re-encoding, reconstructs canonical JSON bytes, and replays the *research local* `Γ` from restored graph rows. **It DOES NOT claim upstream Γ recognized or executed the imported rules.** Native canonical physical `ensure(a,b)` alone cannot be identified with arbitrary source Link IDs because two source Links may have same poles. An identity mapping to accepted MTS source is a separate proof obligation.

Status markers used only after pinned CI success: `NATIVE_UTF8_GRAPH_REGISTRY_ROUNDTRIP_PASS` (transport only). `NATIVE_SOURCE_ANET_PARITY=NOT_EXECUTED`; `NATIVE_GAMMA_RULE_REPLAY=NOT_EXECUTED`; `FULL_V015_INTEROP=NOT_PROVED`.

No merge or acceptance.

## Проверенный S1/S2 над восстановленными идентичностями

[CI #38149360122](https://github.com/netkeep80/mts-nl-compiler/actions/runs/38149360122) — SUCCESS на точном upstream SHA. Из объекта JSON по идентификаторам `P,Q,a,b,x` построен native registry и заново прочитан, затем **на действительных imported native ID anchors** создан структурный `RoleDictionary=[x]`, выбранное `Theory→Rule`, `Antecedent=P(x)`, `Image=Q(x)`. Принятые upstream функции `unifyStructuralRuleTemplate` и `instantiateV013StructuralTemplate` дают binding `x=a` и Link `Q(a)`. Контрпроверка `Q(a)` как посылки вместо `P(a)` отклонена, а невыбранное admission отклоняется через `verifyStructuralRuleAdmission`.

Маркер: `NATIVE_STRUCTURAL_S1_S2_ON_IMPORTED_IDENTITIES_PASS`. **Это не end-to-end Γ:** исполнялся отдельный upstream `S1/S2` API с выбранной структурной rule-вью, а не полная публичная реакция `M_t→Γ(M_t)` с контекстной authority и атомарной публикацией. Для полной приёмки требуются тот же импорт source ANet в штатную `Γ`, native proof provenance и межверсионный replay.
