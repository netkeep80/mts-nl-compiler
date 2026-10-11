# Repo-guard v3.2.4: независимое воспроизведение PR #23

Это **consumer acceptance**, а не новая нормативная семантика. При обновлённом `repo-guard` обычное дополнение существующего `MNC-001` типизированными связями `requires/implements/verifies/documents` должно разрешаться **автоматически**, без изменения доверенного авторского источника.

Содержимое `MNC-001` не меняется по смыслу: идентификатор и все существовавшие записи остаются неизменными. Добавленные записи ссылаются только на реально изменённые в том же PR `src/knowledge-snapshot-v0.mjs`, `tests/knowledge-snapshot-v0.test.mjs` и этот документ. Изменение исходника и теста предметно полезно: физический `knowledge.sqlite` открывается независимым холодным SQLite-потребителем **в режиме read-only**; проверяются `integrity_check`, exact physical rows, циклы и веса, запрет записи.

Реальный позитивный вердикт даст не этот текст, а запускаемая GitHub Actions проверка `repo-guard check-pr`: `requirement-transition.automatic_routine=true`, `governance-change-authorization=PASS`, `blocking job=SUCCESS`. **Не добавлять** отдельный человеческий `GovernanceGrant` к issue этого PR — иначе тест будет ложноположительным.

Исторический красный воспроизводимый сценарий: [PR #23](https://github.com/netkeep80/mts-nl-compiler/pull/23), [CI #38173600530](https://github.com/netkeep80/mts-nl-compiler/actions/runs/38173600530), `v3.2.3`.

Негативные proof-witness проверяются отдельными несливаемыми PR с явно красным blocking status: изменение нормативного поля, удаление старой связи, защищённая цель, отсутствующий в точном diff target. Не ослаблять `repo-policy.json` и не вводить новую authority через тестовый код.
