# GrowLog: Load and Recovery Estimate, Specification v1

## Decisions in brief

- **Retire the "burnout index".** Replace it with a personal estimate of accumulated load, shown as words and ranges, never as a 0-100 score.
- **Use no burnout threshold on daily ratings.** No population cut-off exists for 1-5 daily ratings, and every default in this spec is a prior, a context note or a trend rule.
- **Keep the model simple.** It has one fixed-decay strain stock, a sleep-debt stock and a hard-day count, all compared with the person's own usual.
- **Learn from marked days slowly.** One or two marks change nothing. Three show a range. Five move the line, and the population default keeps half the weight at that point.
- **Show flags in the app only.** Flags are never pushed. Help contacts are always visible and never depend on a score.
- **Add one questionnaire at most.** The monthly check uses the official Korean BAT-23 (work version) for working adults, with the pooled 2023 lines. The 23-item Korean form has no Korean validation of its own: Cho (2020) validated 22 items after dropping item 9. The CBI was dropped because its Korean wording needs written permission. See evidence.md, 한 달 체크.

**Citation key.** Claim ids repeat across topics, so they are prefixed here:
- `INS-` means instruments.
- `THR-` means thresholds.
- `PER-` means personalization.
- `S` ids are the safety claims.

Anything without a claim id is labelled **product choice**, with a reason.

**Evidence labels**

| Label | Meaning |
|---|---|
| Strong | Meta-analysis rated sufficient for that exact outcome |
| Moderate | Consensus guideline or small controlled trials |
| Weak | Single study, cross-sectional data, vendor text, or legal text seen third-hand |
| Convention | Chosen by habit or by us |
| None | No evidence found |

---

## 1. Name and claim

**Names**

| Where | Name |
|---|---|
| Code and docs | Accumulated Strain Estimate (`strainEstimate`) (THR-I25) |
| Screen title | 오늘의 부하와 회복 (S4) |
| Metric label | 쌓인 부하 (추정) |

**The claim, in full:** "기록하신 내용을 바탕으로, 최근의 부하·수면·회복이 내 평소와 얼마나 다른지 요약합니다. 번아웃이나 건강 상태를 판단하지 않습니다."

**Why it cannot be a burnout index**
- WHO's construct has three dimensions: exhaustion, mental distance and reduced efficacy. It is occupational and not a medical condition (INS-I1, S5).
- There is no accepted diagnostic standard, so sensitivity and specificity of burnout measures could not be measured (INS-I5).
- Definitions change counts a great deal. In Korean SME workers, exhaustion alone flagged about four times the three-dimension rate (INS-I16).
- Maslach and Leiter reject exhaustion-only use and summed scores. The MBI publisher removed its cut-offs (INS-I4).
- Korean regulatory exposure rises when a product points at a disease. The KCD listing of Z73.0 was seen only on a weak source, but it is reason enough not to name the index as a burnout measure (S4).

**Where "burnout" (번아웃) may appear**
1. On the About page and the recovery page claim, in a sentence saying the app does not diagnose it.
2. In one helper line under the day marker: "번아웃처럼 느껴진 날도 여기에 표시해 주세요." The label itself stays the person's own experience, 지친 날 (S5). This line is a **product choice**, because it uses the user's own word without confirming anything. Have counsel review it.
3. Inside the citations shown in the monthly check (the BAT and K-BAT titles). The check's own copy does not use the word.

"Burnout" must not appear in the index name, band labels, notifications, store text, landing page or share images (S1, S6).

**Population wording**
- Workers: 일 피로.
- Students: 공부 피로. Treating study as work is the BAT authors' position, which is broader than WHO's (INS-I2).
- Everyone else: 지친 날 only. BAT authors exclude homemakers, retirees and the unemployed as such (INS-I2).

**Construct coverage.** Daily signals cover the exhaustion side only. Distance and efficacy are asked weekly and shown beside the estimate as a pattern line, not added into one number (INS-I1, INS-I4). They stay out of the stock in v1 because the items are unvalidated. The product claims a load comparison, not the construct.

---

## 2. Default thresholds

**No row below is a validated burnout threshold.** "Context note" means a neutral line of text that does not feed the flag.

| Input | Default | Evidence strength | Type | Source and limits |
|---|---|---|---|---|
| Sleep need, 18-64 | 7.0 h | Moderate (consensus) | Prior on a continuous gradient, not a harm line | THR-I1. Mostly Western evidence. |
| Sleep need, 14-17 | 8.0 h | Moderate (consensus) | Prior | THR-I1 |
| Sleep need, 65+ | 7.0 h | Moderate (consensus) | Prior | THR-I1 gives 7-8 h. Lower bound chosen. |
| Time in bed, 7-night mean | ≤6.0 h, or ≥1.0 h below need, with at least 5 of 7 nights logged | Moderate for dose-response; the cut is a design judgement | Trend note | THR-I2. Lab samples n=48 and n=66. Sleepiness ratings miss the deficit, so use logged times. |
| Single short night | No flag | Weak | Feeds debt only | THR-I6. The under-6 h finding rests on 15 cases. |
| Under 18, 7-night mean | <5.0 h triggers a support card | Weak (cross-sectional, n=270,619) | Association band | THR-I12 |
| Nights over 9 h | No penalty | Moderate (consensus) | Not a threshold | THR-I1 |
| Catch-up credit | 1.5 h per night at most | Weak (consensus, not kinetics) | Model constant | THR-I3 gives 1-2 h. One long night never clears the debt. |
| Sleep regularity | No cut-off. 14-day spread of wake time, own history only | Weak for this use (r² about .01) | Trend, display only | THR-I5. Logged times are a coarse proxy. |
| Worker load, 4-week mean | Above 52 h per week: context note | Weak | Korean benchmark | THR-I10, THR-I7. 52 is arithmetic (40 + 12), not a stated ceiling. |
| Worker load, 4-week mean | At or above 55 h per week: long-term health note | Strong for stroke and heart disease in paid work only. Depression evidence inadequate (OR 1.08, 0.94-1.24). Burnout data are cross-sectional associations (THR-I8). | Health benchmark, not a burnout line | THR-I7, THR-I8 |
| Worker load | 12-week mean above 60 h, or 4-week mean above 64 h: benchmark note | Weak (third-party text only) | Administrative benchmark | THR-I10. Confirm official wording before shipping. |
| Load spike | Last 7 days at least 30% above the prior 12-week weekly mean | Weak | Context note, personal comparison | THR-I10 for workers. For others, plain wording with no legal reference. Ratios do not predict outcomes (PER-I14). |
| Long day | At least 12 h logged load: neutral note | Weak (GRADE low or very low; incidents, not burnout) | Single-day note | THR-I11 |
| Study hours | None | None | No threshold | THR-I12. Worker cut-offs are not transferred. |
| Rest days per week | None | None | No threshold | THR-I15 |
| Energy, stress, mood | No population cut-off. Compare with own usual | None | Within-person only | PER-I1, THR-I20, INS-I21 |
| Hard day | At least 2 of: stress ≥4, energy ≤2, mood ≤2 | Convention | Ordinal count | **Product choice**: a count at the scale ends avoids treating ratings as metric (PER-I5). |
| Recovery activity | 150 min per week (adult) or 60 min per day (under 18) as guidance. No failure state below it. | Moderate for health and depression, not burnout | Concave buffer | THR-I17, THR-I18 |
| Switching off | No cut-off, own history only | Moderate association (r=-.36, high heterogeneity) | Small buffer | THR-I13 |
| Monthly check (CBI personal) | 25, 50, 75 are developer quarters. 50 is the conventional line. | Convention | Internal support trigger | INS-I7, INS-I8. Danish data, no criterion validation. |
| Trend line T | 3.0 | Convention, tuned on synthetic data | Personal trend limit | **Product choice**: section 4.8. Method from PER-I8. |

**Deliberately not used**
- BAT lines such as 2.59 and 3.02. They apply to BAT totals only, and neither line applies to GrowLog's own 1-5 items (INS-I12). They also moved between European countries (INS-I13).
- PSS cut-offs (INS-I24).
- OLBI cut-offs, whose derivation is unverified (INS-I17).
- PHQ-9's 10 and WHO-5's 13 (S21, S22).
- The 11-hour rest gap (THR-I11). **Product choice**: the app does not log start and end times.

---

## 3. What the user records

### Daily, target 30 seconds

**Product choice**: the 30-second target protects retention (PER-I24).

| Item | Status | Notes |
|---|---|---|
| Energy, stress, mood, 1-5 | Existing | Stress stays GrowLog's own wording. Do not borrow PSS items (INS-I23). One fatigue rating has diary support, though in a 1-10 format and not in Korean (INS-I22). |
| Bed time, wake time, sleep quality | Existing | The night belongs to the wake date. Time in bed is what the sleep trials measured (THR-I2). |
| Load and recovery minutes by area | Existing | Store empty as null, not 0. |
| "오늘 일·공부에서 마음이 꺼졌나요?" 1-5 | New, optional | Own wording, scored within person (THR-I13). Do not copy Recovery Experience items. |
| "오늘 어땠나요?" one line | New, optional | Stored locally and never parsed. **Product choice**: keyword scanning would drift into crisis detection (S3). |

- Entries can be added until noon the next day, and catch-up is allowed for 3 days back. A long logging window is advised (S25).
- Skipped days carry no penalty (S15).
- No second daily energy rating in v1. THR-I15 and THR-I23 suggest value, but **product choice**: the burden is not justified yet.

### Weekly review, target 30 seconds

Shown in the app at a user-chosen time. A weekly surface fits slow drift better than pushes (PER-I24).

1. **쌓인 정도 (1-5):** how much has built up this week.
2. **거리감 (1-5):** how far the person feels from work or study.
3. **해낸 느낌 (1-5):** how much they felt they got done well.

All three are GrowLog-owned and unvalidated. Weekly suits distance because within-person it correlated .94 with exhaustion and had low reliability (INS-I21). They must be written fresh, and a reviewer must confirm they are not paraphrases of MBI, BAT or OLBI items (INS-I3, INS-I10, INS-I17).

A felt-accumulation answer of 5 is stored as a soft mark (`sev: 1, soft: true`), because full episodes will be rare (THR-I22) and a single periodic self-rating is a defensible label (INS-I19).

Every 4 weeks, add one question: 이 기록이 도움이 되고 있나요? (S14).

### The day marker: 지친 날로 표시

- Available from the daily screen and the history view. Records may be back-dated, with a fuzzy date of exact, about 3 days, or about 7 days. Back-dating matters because people often stop logging near the event (PER-I16).
- It is a self-label, not a clinical event (INS-I1).

| Severity | Label (behaviour anchored) | Effect |
|---|---|---|
| 1 | 많이 지쳤지만 할 일은 했어요 | Mark, weight 0.5 |
| 2 | 할 일을 미루거나 줄였어요 | Mark, weight 1, opens 회복 중 |
| 3 | 일상을 멈춰야 했어요 | Mark, weight 1, opens 회복 중, shows the help card at once |

**Product choice**: functional anchors avoid clinical terms, and the half weight reflects that severity 1 will be common.

- 회복 중 stays open until the user taps 이제 괜찮아졌어요. It never clears itself and never shows a date (THR-I16).
- Optional tag: 일, 공부, 관계, 건강, 기타.

**Snapshot.** Each marked episode shows what preceded it:
- Hard days in the prior 14 days.
- Peak sleep debt.
- Average load hours per week.
- Peak strain level.

This is the direct answer to "how much had built up when it arrived".

### Periodic questionnaire

| Instrument | License status (exact) | Decision |
|---|---|---|
| CBI personal, 6 items | NFA says it may be used freely for non-commercial and commercial purposes if the source is clearly cited. No fee or request is mentioned. The page is silent on adaptation and translation (INS-I6). | Dropped. Korean wording needs written permission; 한 달 체크 uses the BAT-23. |
| **BAT-23 Korean** | Free without requesting permission, must not be modified, citation required (INS-I10). The user manual allows online use with automatic scores. Official Korean file has 23 core items, Cho's validated form has 22 (INS-I15). | **Shipped as 한 달 체크**, monthly and optional, working adults only. No Korean student or general form exists (INS-I2). |
| BAT-12, BAT4 | BAT-12 is the authors' own short form (asterisked items 1, 3, 4, 9, 11, 13, 14, 17, 18, 19, 20, 23), so using exactly those items is not a modification; self-chosen subsets and rewording are (INS-I10). BAT4 is for group screening with no cut-offs (INS-I14). | Not used. The user manual prefers the full version for individual feedback, and the BAT-12 red line differs between sources (2.96 vs 3.04), while the BAT-23 lines agree across the manual and the 2023 paper. All lines are preliminary. |
| MBI | Research-only licence bars individual feedback. Paid reports exist through Mind Garden's hosting. No page addresses apps (INS-I3). | Excluded. Do not paraphrase. |
| OLBI | No official licence found (INS-I17) | Excluded |
| SMBM | Noncommercial educational or research only, with results-sharing conditions (INS-I18) | Excluded |
| PSS-10 | Permission through ePROVIDE, and the Korean translator holds the translation rights. Fee unknown (INS-I23). | Not v1 |
| PSS-4 | Marginal in Korean patients, alpha .55 (INS-I25) | Excluded |
| WHO-5 | CC BY-NC-SA 3.0 IGO, with commercial use by WHO request. Korean evidence found only in adults over 65 (S22). | Later candidate |
| PHQ-9, GAD-7 | Not reviewed for licence | Do not embed (S9) |
| KBOSS | Licence unknown (INS-I16) | Excluded |

*Historical: the CBI plan below was not shipped.*

**Why CBI personal:** it is the only measure with an explicit commercial-use statement, and its personal scale has no work wording, so it fits students and non-workers better (INS-I6, INS-I7). A Korean version exists, but in homecare workers, and the article mentions no permission from the CBI authors (INS-I9).

**Required before the CBI can ship**
1. Email NFA, whose named contact is Prof. Thomas Clausen. Ask for written confirmation that a Korean version may be displayed in a free PWA, and that no wording may change.
2. Ask Jeon et al. whether their Korean wording may be reused, and keep both replies on file.
3. Show the Borritz et al. 2006 citation in the app (INS-I6).
4. Use the personal scale at fixed wording. Do not reword it for students.
5. Score 0, 25, 50, 75, 100 and average. Require at least 3 of 6 answered. Do not print items in the listed order (INS-I7).
6. Title the screen 한 달 체크. **Product choice**, extending the BAT manual's rule of dropping the word from the title (INS-I11).
7. Recheck terms if the app ever charges money.

**If any permission fails:** ship without it. The weekly items stay as they are.

**Cadence:** a new check opens 28 days after the last completed check started. **Product choice**: no source recommends a repeat interval, and the 1-month (Japan, .64) and 6-month (Flanders, .74) stabilities come from different samples (INS-I20, INS-I30). Responsiveness has not been shown for any burnout measure (INS-I5).

**Display (CBI plan, superseded by the BAT check in evidence.md):** compare only with the person's own past scores. Danish and homecare means are context, not norms (INS-I7, INS-I9). Report a change only after 4 checks, and only when it exceeds `1.96 × √2 × SD` of the user's earlier monthly scores (INS-I20).

---

## 4. Personal model

### 4.1 Principles

- Store raw logs only. Everything else is a pure function of them, so back-dating and edits simply replay.
- Population data may seed a person's mean, but not their spread or their correlations (PER-I1).
- Keep level and spread only. More complex dynamics add little (PER-I11).
- Decay constants are stated assumptions, not fitted. Personal Banister fits are unstable even with measured performance (PER-I13).
- A stress total is descriptive, not a validated burnout quantity (PER-I15, THR-I19).
- Existing users keep their raw logs. Discard old index values.

### 4.2 Baseline for each signal

The baseline window is the last 84 eligible entries, excluding:
- The first 3 entries, because of initial elevation (PER-I4).
- Flagged days and 회복 중 days. Otherwise a rolling baseline absorbs chronic strain (PER-I7).
- The most recent 14 days, once 42 entries exist. **Product choice**: a slow rise should not teach the baseline it is normal.

```
centre_n = (n·median(own) + k·μ0) / (n + k),   k = 2
spread_n = max(floor, sqrt((ν0·σ0² + (n-1)·s²) / (ν0 + n - 1))),   ν0 = 14
```

k=2 rounds the 1.2-2.6 pseudo-days derived from ICC .28-.45 (PER-I19, PER-I2). Those ICCs come from Polish workers, so this is an extrapolation. The stronger spread prior follows PER-I19. Spread is not scaled by plain MAD, which is often 0 on rounded ratings (PER-I6).

**How defaults fade into personal values**

| Baseline entries | Weight on own centre, n/(n+2) | Weight on own spread, (n-1)/(n+13) | SD relative error (PER-I3) |
|---|---|---|---|
| 1 | .33 | 0 | |
| 3 | .60 | .13 | |
| 7 | .78 | .30 | |
| 14 | .88 | .48 | about 20% |
| 28 | .93 | .66 | about 14% |
| 60 | .97 | .81 | about 9% |
| 84 | .98 | .86 | |

Day counts for one daily rating are extrapolated from ICCs and momentary-prompt data (PER-I2, PER-I3).

**Sleep need** starts from the age prior `N0`. From 28 baseline entries:

```
N̂ = median time in bed on baseline days with energy ≥ own median energy
N = clamp((14·N0 + m·N̂)/(14 + m), N0 - 1, N0 + 2)
```

Own weight m/(m+14) is .33 at 7, .50 at 14, .67 at 28, .81 at 60. THR-I1 supports replacing the prior as data accumulates. The estimator is a **product choice** and unvalidated. The clamp stops chronic short sleep from redefining need.

### 4.3 Strain and recovery

**Rating signal.** `C_t` is the mean of available `6-energy, stress, 6-mood, 6-quality`. A multi-item composite has more distinct values (PER-I6). Then:

```
zR = clamp((C_t - centre)/spread, -3, 3)
```

**Load signal.** Baselines are kept separately for weekdays and weekends. Weekday effects exist (THR-I20). The two buckets are a **product choice**. It needs 4 entries in the bucket.

```
zL = clamp((L_t - centre)/spread, -3, 3)
```

**Sleep debt.** A stock that decays over several nights and is capped per night (THR-I3):

```
gap = N - TIB_t
D_t = clamp((6/7)·D_(t-1) + (gap > 0 ? gap : -min(1.5, -gap)), 0, 21)
zD  = clamp(D_t / 7, 0, 3)
```

At steady state D is 7 times the nightly shortfall, so zD reads as hours short per night. It is deliberately not centred on the person's usual, because people under-report chronic deficit (THR-I2).

**Recovery buffer**

```
V_t = 0.15·(1 - exp(-R7/τ)) + 0.10·clamp(zDet, 0, 2)/2
```

- R7 is logged recovery minutes over the last 7 days.
- τ=75 for adults and 210 for under-18s. Credit reaches .63 at 75 min, .86 at 150 min and .98 at 300 min, matching the concave shape in THR-I17.
- The buffer stays small because exercise is not an established burnout treatment (THR-I18).
- Population shape only. **Product choice** on the exact curve.

**Daily input**, with weights renormalised over available signals:

```
U_t = (wR·zR + wL·zL + wD·zD) / (sum of available weights) - V_t
```

| Role | wR ratings | wL load | wD sleep | Reason |
|---|---|---|---|---|
| Default | .40 | .35 | .25 | Load is the largest predictor among those with 3 or more studies, rho .38, about 14% shared variance (THR-I9). Ratings are the only direct report of state. |
| Student | .40 | .20 | .40 | No study-hour threshold exists, and sleep is the clearer signal (THR-I12) |

The weights are a **product choice**, fixed, never learned per person (PER-I18).

**Strain stock** (an EWMA, the same computation as a leaky integrator, PER-I8):

```
S_t = max(-2·SE_t, 0.9·S_(t-1) + 0.1·U_t)
SE_t = σU · sqrt(0.1/1.9) · g_t
g_t  = (t975(n+13)/1.96) · sqrt(1 + 1/n)
T_t  = S_t / SE_t
```

- λ=.10 is a half-life of about 6.6 days (PER-I8).
- `g_t` widens limits when data are short (PER-I7).
- The floor stops banked rest. A holiday must not reset the stock, and vacation effects fade quickly (THR-I14).
- Windows of weeks rather than days follow THR-I9.

### 4.4 Bands and the flag

| Band | Rule | Copy |
|---|---|---|
| usual | T < 2 | 내 평소 범위예요 |
| higher | 2 ≤ T < θ | 평소보다 조금 높아요 |
| sustained | T ≥ θ on 3 consecutive logged days, **and** the hard-day tail test passes | 한동안 평소보다 높아요 |

**Hard-day tail test** (PER-I5, PER-I19). Over the last 14 days, with at least 10 logged:

```
P(X ≥ x) ≤ 0.10 under Beta-binomial(14-day n, 1 + base hits, 4 + base misses)
```

The prior mean of .20 is a **product choice**.

- The flag clears when T < 2 on 3 consecutive logged days.
- A 14-day cooldown follows.
- No flag before 28 entries (PER-I7).
- A single bad day never flags (PER-I2, THR-I20).
- The flag is never a push.

**Honesty check.** From 60 entries, compare next-day absolute error of an EWMA of `C_t` against "same as yesterday" over the last 60 entries (PER-I19). If the EWMA does not win, hide trend words and show counts only. **Product choice** on the fallback.

**Weekly rebound**, from 60 entries: energy after a rest block minus energy before it, against the user's own median. Show it as an observation only. It is unvalidated (THR-I15).

### 4.5 How marked days update the personal line

1. Merge marks within 14 days into one episode, keeping the highest severity. **Product choice**: they are not independent.
2. `level` = max T in the window from 14 days before the first mark to the last mark, widened by the date fuzz. A fixed lag is not supported (THR-I21).
3. An episode counts only with at least 7 logged days in the window that have T. Otherwise it stays a label. Data near events go missing (PER-I16).
4. An episode is `visible` if level ≥ 2. Below that the records showed nothing, so it says nothing about a line. Show it as 기록상 잘 보이지 않았어요.

```
nEff = sum over visible episodes of (sev 1 → 0.5, else 1)
if nEff < 5:  θ_blend = 3.0
else:         θ_blend = (5·3.0 + nEff·Q25) / (5 + nEff)     // Q25 of levels capped at 6
θ = clamp(θ_blend + 0.25·min(quiet, 2), 2.5, 4.5)
```

`quiet` counts flags from the last 180 days, more than 14 days old, with no mark from 3 days before to 14 days after. Without it, events could only ever lower the line. Q25 is used so that most marked episodes had reached the line.

| Usable episodes | What happens |
|---|---|
| 0-2 | Stored and listed. No line, no range. |
| 3-4 | Show the observed min-max and the count. Flags are unchanged. |
| nEff ≥ 5 | Line moves. Weight on own data: .50 at 5, .67 at 10, .80 at 20. |

Why so strict: a 95% prediction interval for the next event's level from n past events is about ±15.6 SD at n=2, ±5.0 at n=3, ±3.0 at n=5 and ±2.4 at n=10 (PER-I18). The 3 and 5 gates are convention, as no published minimum for one person was found (PER-I18). No personal classifier is trained on these labels.

**After an episode.** When a severity 3 episode closes, the baseline starts a new segment. The old centre becomes the prior with k=7, and flags pause for 14 entries. Tolerance may differ afterwards, so pre- and post-episode baselines must not merge (THR-I16).

**New normal.** After 56 days of continuous flag or 회복 중, ask 요즘이 내 새로운 평소인가요? Yes writes a `rebase` record, and the same segment rule applies. **Product choice**: without this, a frozen baseline can flag forever.

### 4.6 Missing days

Never impute a gap as neutral or average, and do not let totals quietly decay across gaps (PER-I20).

| Gap since last entry | Behaviour |
|---|---|
| 1-3 days | S and D hold. Band shown as of the last entry. Offer catch-up. |
| 4-13 days | Show 최근 기록이 없어서 지금은 알 수 없어요. S holds. No new flag until 3 entries after return. |
| 14 days or more | S restarts at 0, labelled 다시 시작. Baseline is kept. No flag for 7 entries. Nothing implies recovery. |
| Field missing | Drop that signal and renormalise. D holds. |

The cut-offs are **product choices** (PER-I20). A logging stop is stored as a fact, and it never triggers a push or a reproach.

Most stage gates count entries, not calendar days. Logging rates in the 70-85% range are typical even in research (PER-I20).

### 4.7 Ordinal ratings

- Never show decimals. Show medians, the middle-half range of integers, and counts.
- The composite mean is internal only, and the flag also needs the ordinal test (PER-I5).
- An ordered-probit is **not** used. **Product choice**: the benefit for one person's sparse data does not justify the cost.

### 4.8 Calibration on synthetic data

This is my own simulation, not evidence. It used rounded Gaussian AR(.3) ratings at mean 3 and item SD about .8, 85% logging, and a stationary user unless noted. Stationary and delay columns used 250 runs. Rows with weekly rises used 60-70 runs.

Flags per year, with the tail test:

| Line θ | Stationary, exercise logged | Stationary, no exercise | Plus six 1-week rises a year | Plus six 2-week rises a year | Median delay, sustained +1 SD | Missed at 120 days, +1 SD | Missed, +0.5 SD |
|---|---|---|---|---|---|---|---|
| 2.5 | not run | 0.64 | 1.41 | not run | not run | not run | not run |
| **3.0** | 0.10 | 0.29 | 0.99 | 2.06 | 15 days | 2% | 55% |
| 3.5 | 0.03 | 0.13 | 0.55 | 1.36 | 17 days | 8% | 75% |

- 3.0 lands in the "one or two a year" range that PER-I8 proposed, once ordinary life rises are included.
- A one-sided EWMA with limits near L=3.5 gave a similar rate in PER-I8. This model is more conservative because of the prior, the widened limits and the 3-day rule.
- The tail test changed little: with no exercise, 0.40 fell to 0.29 and 1.36 fell to 0.99, at the same delay. It stays as protection against metric artefacts (PER-I5), and its count doubles as the user-visible evidence line.
- Real users are not stationary, so treat all of this as design guidance.

The reference code below was run with gaps, marks, a closed severity 3 and a rebase, and produced no NaN. A tiny recheck of an earlier build (3 runs, then 27 runs) gave 0.17 flags a year and a 12-day delay. It has not been run in a browser or timed on a phone. Recompute costs days × 84, so run it on open and memoise it.

### 4.9 Reference code

Entry fields: `date, energy, stress, mood, sleepQ, tibH, loadMin, recMin, detach`.
Event fields: `date, sev, fuzz, closedOn`, or `{date, rebase: true, closedOn}`.
Profile: `{role, age: 'u18'|'adult'|'senior'}`.

```js
// GrowLog strain model v1. A pure function of raw logs; nothing derived is stored.
const K = {
  LAMBDA: 0.10, T_HIGH: 2, THETA0: 3.0, THETA_MIN: 2.5, THETA_MAX: 4.5,
  K_MEAN: 2, K_SEG: 7, NU0: 14, WIN: 84, GUARD: 14, GUARD_MIN: 42, SKIP: 3,
  S0_R: 0.6, FL_R: 0.4, S0_L: 60, FL_L: 30, S0_U: 0.75, FL_U: 0.4, S0_D: 0.8, FL_D: 0.5,
  RHO: 6 / 7, CREDIT: 1.5, DMAX: 21, V_EX: 0.15, V_DET: 0.10, K_NEED: 14,
  TAIL: 0.10, ON: 3, OFF: 3, COOL: 14, TREND_MIN: 28,
  GAP_UNKNOWN: 4, GAP_RESTART: 14, HOLD_RETURN: 3, HOLD_RESTART: 7, HOLD_SEG: 14,
  MERGE: 14, LOOKBACK: 14, MIN_COVER: 7, K_EVENT: 5, EVENT_GATE: 5,
};
const WEIGHTS = { default: { R: 0.40, L: 0.35, D: 0.25 }, student: { R: 0.40, L: 0.20, D: 0.40 } };
const NEED0 = { u18: 8, adult: 7, senior: 7 };
const TAU = { u18: 210, adult: 75, senior: 75 };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const num = x => (x == null ? NaN : x);
const finite = a => a.filter(Number.isFinite);
const quantile = (a, p) => {
  const s = Float64Array.from(a).sort(), i = (s.length - 1) * p, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};
const median = a => quantile(a, 0.5);
const variance = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
const t975 = nu => 1.96 + 2.37 / nu + 2.82 / (nu * nu);
const dayNum = s => Date.parse(s + 'T00:00:00Z') / 864e5;
const isWeekend = t => [0, 6].includes(new Date(t * 864e5).getUTCDay());

// Prior-to-personal blend. k = 0 means no prior on the centre.
function blend(v, mu0, k, s0, nu0, floor) {
  const n = v.length, df = Math.max(0, n - 1);
  const c = n + k > 0 ? ((n ? n * median(v) : 0) + k * mu0) / (n + k) : mu0;
  const s = Math.max(floor, Math.sqrt((nu0 * s0 * s0 + df * variance(v)) / (nu0 + df)));
  return { c, s, n };
}
// P(X >= x) for x hard days out of n under Beta-binomial(a, b).
function tailProb(x, n, a, b) {
  let p = 1, cdf = 0;
  for (let i = 0; i < n; i++) p *= (b + i) / (a + b + i);
  for (let k = 0; k < x; k++) { cdf += p; p *= ((n - k) / (k + 1)) * ((a + k) / (b + n - k - 1)); }
  return Math.max(0, 1 - cdf);
}
const isValid = e => finite([num(e.energy), num(e.stress), num(e.mood)]).length >= 2;

function episodesAt(t, marks, days, first) {
  const eps = [];
  for (const e of marks) {
    if (e.t > t) break;
    const p = eps[eps.length - 1];
    if (p && e.t - p.t2 <= K.MERGE) {
      p.t2 = e.t; p.sev = Math.max(p.sev, e.sev); p.fuzz = Math.max(p.fuzz, e.fuzz || 0);
    } else eps.push({ t1: e.t, t2: e.t, sev: e.sev, fuzz: e.fuzz || 0 });
  }
  for (const p of eps) {
    const from = p.t1 - K.LOOKBACK - p.fuzz, to = Math.min(t, p.t2 + p.fuzz);
    const win = days.slice(Math.max(0, from - first), Math.max(0, to - first + 1));
    const seen = win.filter(d => d.logged && d.T != null);
    const load = finite(win.filter(d => d.logged).map(d => num(d.loadMin)));
    p.level = seen.length >= K.MIN_COVER ? Math.max(...seen.map(d => d.T)) : null;
    p.visible = p.level != null && p.level >= K.T_HIGH;
    p.hardDays = win.filter(d => d.hard).length;
    p.debtH = seen.length ? Math.max(...seen.map(d => d.debt)) : null;
    p.loadHoursPerWeek = load.length ? (mean(load) * 7) / 60 : null;
  }
  return eps;
}
function thetaAt(t, marks, days, first, flags) {
  const vis = marks.length ? episodesAt(t, marks, days, first).filter(p => p.visible) : [];
  const nEff = vis.reduce((s, p) => s + (p.sev === 1 ? 0.5 : 1), 0);
  let theta = K.THETA0;
  if (nEff >= K.EVENT_GATE) {
    const q25 = quantile(vis.map(p => Math.min(p.level, 6)), 0.25);
    theta = (K.K_EVENT * K.THETA0 + nEff * q25) / (K.K_EVENT + nEff);
  }
  const quiet = flags.filter(f => t - f > 14 && t - f <= 180 &&
    !marks.some(e => e.t >= f - 3 && e.t <= f + 14)).length;
  return clamp(theta + 0.25 * Math.min(quiet, 2), K.THETA_MIN, K.THETA_MAX);
}
function derive(entries, events, profile, today) {
  const byDay = new Map(entries.filter(isValid).map(e => [dayNum(e.date), e]));
  if (!byDay.size) return { days: [], flags: [], episodes: [], theta: K.THETA0 };
  const first = Math.min(...byDay.keys());
  const last = today ? dayNum(today) : Math.max(...byDay.keys());
  const ev = events.map(e => ({ ...e, t: dayNum(e.date) })).sort((a, b) => a.t - b.t);
  const marks = ev.filter(e => !e.rebase);
  const segEnds = ev.filter(e => (e.sev === 3 || e.rebase) && e.closedOn).map(e => dayNum(e.closedOn));
  const w = WEIGHTS[profile.role === 'student' ? 'student' : 'default'];
  const need0 = NEED0[profile.age], tau = TAU[profile.age];
  const hist = [], days = [], flags = [], rec7 = [];
  let S = 0, D = 0, count = 0, lastT = null, flagged = false, offRun = 0, onRun = 0;
  let cool = 0, hold = 0, seg = 0, priorC = 3, kC = K.K_MEAN, lastC = 3;

  for (let t = first; t <= last; t++) {
    const d = byDay.get(t);
    rec7.push(d ? num(d.recMin) || 0 : 0);
    if (rec7.length > 7) rec7.shift();
    if (cool > 0) cool--;
    if (!d) {
      const gap = t - lastT;
      if (gap === K.GAP_UNKNOWN) { hold = Math.max(hold, K.HOLD_RETURN); onRun = 0; }
      if (gap === K.GAP_RESTART) { S = 0; flagged = false; hold = K.HOLD_RESTART; onRun = 0; }
      days.push({ t, logged: false, known: gap < K.GAP_UNKNOWN, T: null });
      continue;
    }
    lastT = t; count++;
    const nowSeg = segEnds.filter(c => c < t).length;
    if (nowSeg !== seg) {
      seg = nowSeg; priorC = lastC; kC = K.K_SEG; hold = K.HOLD_SEG; flagged = false; onRun = 0;
    }
    const energy = num(d.energy), stress = num(d.stress), mood = num(d.mood), sleepQ = num(d.sleepQ);
    const comp = mean(finite([6 - energy, stress, 6 - mood, 6 - sleepQ]));
    const hard = (stress >= 4) + (energy <= 2) + (mood <= 2) >= 2;
    const tib = num(d.tibH), det = num(d.detach), loadMin = num(d.loadMin);

    const base = [];
    for (let i = hist.length - 1; i >= 0 && base.length < K.WIN; i--) {
      const h = hist[i];
      if (h.ok && h.seg === seg && (hist.length < K.GUARD_MIN || h.t <= t - K.GUARD)) base.push(h);
    }
    const bR = blend(base.map(h => h.comp), priorC, kC, K.S0_R, K.NU0, K.FL_R);
    lastC = bR.c;
    const zR = clamp((comp - bR.c) / bR.s, -3, 3);

    let need = need0;
    if (base.length >= K.TREND_MIN) {
      const en = median(finite(base.map(h => h.energy)));
      const good = finite(base.filter(h => h.energy >= en).map(h => h.tib));
      if (good.length) {
        const blended = (K.K_NEED * need0 + good.length * median(good)) / (K.K_NEED + good.length);
        need = clamp(blended, need0 - 1, need0 + 2);
      }
    }
    if (Number.isFinite(tib)) {
      const short = need - tib;
      D = clamp(K.RHO * D + (short > 0 ? short : -Math.min(K.CREDIT, -short)), 0, K.DMAX);
    }
    const zD = Number.isFinite(tib) ? clamp(D / 7, 0, 3) : null;

    const wknd = isWeekend(t);
    const lv = finite(base.filter(h => h.wknd === wknd).map(h => h.loadMin));
    let zL = null;
    if (Number.isFinite(loadMin) && lv.length >= 4) {
      const bL = blend(lv, 0, 0, K.S0_L, K.NU0, K.FL_L);
      zL = clamp((loadMin - bL.c) / bL.s, -3, 3);
    }
    let sum = w.R * zR, wSum = w.R;
    if (zL != null) { sum += w.L * zL; wSum += w.L; }
    if (zD != null) { sum += w.D * zD; wSum += w.D; }

    const R7 = rec7.reduce((a, b) => a + b, 0);
    let V = K.V_EX * (1 - Math.exp(-R7 / tau));
    if (Number.isFinite(det)) {
      const bD = blend(finite(base.map(h => h.det)), 3, K.K_MEAN, K.S0_D, K.NU0, K.FL_D);
      V += (K.V_DET * clamp((det - bD.c) / bD.s, 0, 2)) / 2;
    }
    const U = sum / wSum - V;

    const bU = blend(base.map(h => h.U), 0, 0, K.S0_U, K.NU0, K.FL_U);
    const n = base.length, nu = n + K.NU0 - 1;
    const g = (t975(nu) / 1.96) * Math.sqrt(1 + 1 / Math.max(n, 1));
    const se = bU.s * Math.sqrt(K.LAMBDA / (2 - K.LAMBDA)) * g;
    if (hist.length >= K.SKIP) S = (1 - K.LAMBDA) * S + K.LAMBDA * U;
    S = Math.max(S, -2 * se);
    const T = S / se;

    let x = hard ? 1 : 0, m = 1;
    for (let i = hist.length - 1; i >= 0 && hist[i].t > t - 14; i--) { x += hist[i].hard ? 1 : 0; m++; }
    const hits = base.filter(h => h.hard).length;
    const tail = m >= 10 ? tailProb(x, m, 1 + hits, 4 + base.length - hits) : 1;

    const theta = thetaAt(t, marks, days, first, flags);
    onRun = T >= theta ? onRun + 1 : 0;
    if (hold > 0) hold--;
    if (!flagged && count >= K.TREND_MIN && hold === 0 && cool === 0 && onRun >= K.ON && tail <= K.TAIL) {
      flagged = true; offRun = 0; flags.push(t);
    } else if (flagged) {
      offRun = T < K.T_HIGH ? offRun + 1 : 0;
      if (offRun >= K.OFF) { flagged = false; cool = K.COOL; }
    }
    const recovering = marks.some(e => e.sev >= 2 && e.t <= t && (!e.closedOn || dayNum(e.closedOn) >= t));
    hist.push({ t, seg, comp, hard, U, energy, tib, det, loadMin, wknd,
      ok: hist.length >= K.SKIP && !flagged && !recovering });
    days.push({
      t, logged: true, known: true, T: count >= K.TREND_MIN ? T : null, S, U, comp, hard,
      debt: D, need, loadMin, hardCount: x, hardWindow: m, tail, theta, flagged,
      band: count < K.TREND_MIN ? 'building' : flagged ? 'sustained' : T >= K.T_HIGH ? 'higher' : 'usual',
    });
  }
  return {
    days, flags, entries: count,
    episodes: episodesAt(last, marks, days, first),
    theta: thetaAt(last, marks, days, first, flags),
  };
}
```

### 4.10 Not built, because the evidence does not justify it

- Rising variance or autocorrelation alarms (PER-I10, THR-I24).
- Bayesian changepoint detection (PER-I12). Sudden transitions are not established here, and it has no validation on daily mood or burnout self-report.
- Fitted personal Banister parameters (PER-I13).
- Acute-to-chronic ratios or a 0.8-1.3 band (PER-I14).
- A hierarchical model on the phone (PER-I19).
- Reactivity, inertia and network metrics in v1 (THR-I19, PER-I11).
- Any claim of allostatic load (THR-I25).

### 4.11 What the app must not conclude

- That the person has, or will have, burnout, depression or any condition (INS-I1, INS-I11, S4).
- That a flag predicts anything. With one event a year, even 80% sensitivity and 90% specificity would give a positive predictive value near 24% (PER-I17).
- That a low band means safe (S19).
- That stress or short sleep caused anything. Sleep may be symptom as well as cause, and reverse paths are often larger (THR-I6, THR-I21).
- That the marked level is a limit, or how many days remain (THR-I22, S15).
- That one person's pattern applies to others, or that population data fit this person (PER-I1).
- That recovery is complete because logging resumed or a date passed (THR-I16).
- That tracking reduces stress (S16).

---

## 5. What the user sees

Stages count logged entries. Milestones at 7, 14 and 28 make personalization visible early, because most users will not stay (PER-I21, S23). Defaults must work alone from day 1. A two-window scheme of a first read within 4-14 days and a long baseline of 30-60 days matches vendor practice, but it is convention (PER-I22).

| Stage | Entries | Shown | Not shown | Uncertainty |
|---|---|---|---|---|
| 1. 기록 시작 | 1-6 | Today's entry. Sleep against the guideline, worded as a guide. Long-day note. | Personal comparison, any band | "기록 3/7. 아직 내 평소를 알 만큼 쌓이지 않았어요." |
| 2. 잠정 평소 | 7-13 | Median per signal, marked 잠정 (PER-I3) | Spread, flags | "첫 기록은 평소보다 높게 나올 수 있어요" (PER-I4) |
| 3. 2주 요약 | 14-27 | Hard-day count, sleep debt note, first weekly review, the middle-half range of each rating | Trend words | Evidence strip: 기록 19일 |
| 4. 추세 확인 | 28-59 | The three bands, shaded usual zone on the chart, flag card, personal sleep need once 28 baseline entries exist |  | Strip: 기록 34일 · 표시한 날 1번. Numeric ranges, not hedging words (PER-I25). |
| 5. 내 패턴 | 60+ | Rebound note, regularity spread. Load-spike note after 13 weeks. | | Strip continues. Honesty check applies. |
| Marks overlay | 3 or more episodes | Snapshot ranges, for example: 표시한 3번, 그 전 2주 동안 힘든 날 6~9일 | Personal line until nEff ≥ 5 | "3번뿐이라 규칙이라고 말할 수 없어요." Ranges with n. |

**Display rules**
- No 0-100 number. A number presented as an objective reading is not neutral (S17). No single number on a red line (INS-I4). The one exception is the monthly BAT-23 mean, shown against its published lines in neutral styling with the owner's request as the reason.
- Show the score as a summary of what the user entered. No red and no warning styling (S15).
- Lead with what helped, such as restful days (S15).
- Do not draw a personal line until 3 episodes exist, and then draw a band, not a line. Never phrase it as a countdown (S15).
- Every band opens to its inputs and formula. No vendor composite has been validated, so transparency is the advantage here (PER-I23).
- Users can hide the estimate, pause logging and reset (S14).

**Flag card.** It must name what was logged: "지난 14일 중 9일이 힘든 날이었고, 수면은 평소보다 적었어요." Then it offers one way to subtract, such as an earlier bedtime or dropping one task. Never prompt an exhausted user to do more or to exercise (THR-I18). Add: "기록을 요약한 것이며, 앞으로 일어날 일을 말해주지 않아요."

---

## 6. Safety rules

### Always available

- A 많이 힘들어요 link in the header of every screen opens contacts directly. It is not gated by any score (S12, S19, S20).
- No scored daily suicide question. Plain language about hard moments is unlikely to harm (S20), but an unattended risk score runs into S3 and S19.
- State plainly: this app does not watch for emergencies (S3).

### Support card triggers

The wording is supportive and based on what was logged, not a generic high-score message (S18). The template follows S8, though S8 is not a Korean safe harbour: "요즘 힘든 날이 이어졌네요. 누군가와 이야기해 보는 것도 도움이 될 수 있어요."

| ID | Exact trigger | Basis |
|---|---|---|
| H1 | At least 10 of the last 14 calendar days logged, and at least 75% of logged days have mood ≤2 or energy ≤2 | Convention from the two-week duration wording (S22). No validated threshold exists. Uses absolute ratings so a low baseline cannot hide it. |
| H2 | Flag active for 14 consecutive days | **Product choice**: sustained pattern |
| H3 | Severity 3 saved | **Product choice**: the user reports stopping daily life |
| H4 | Monthly BAT check, shown only while the check itself is shown (working adult, not hidden): the latest completed check started within 28 days, and it is at 3.02 or over, or it and the check before it are both at 2.59 or over. No number, line or band name in the text. | Pooled 2023 lines. Two checks because one result near a line can flip by measurement error alone. |
| H5 | 회복 중 open for 28 days | **Product choice**. Long courses exist in severe cases (THR-I16). |
| H6 | Under 18 and 7-night mean time in bed <5 h, with at least 5 nights logged | THR-I12 |

**Rate limit:** one card per 14 days, except H3. Cards can be dismissed. The header link stays. Repeated alerts could look like condition management (S8).

**Not triggers:** a logging stop, note text, or a T value alone.

Cards never show a number or line, name a disease, or say 비정상 (S8). Do not map GrowLog data onto PHQ-9's 10 (S21).

### Contacts

Verified 2026-10-31 (S12). Keep them in one file, show a "last checked" date, and recheck each on its official page before every release (S13).

| Show | Label | Rule |
|---|---|---|
| **109** | 자살예방 상담, 24시간 | First, tap to call |
| **1577-0199** | 정신건강 상담 | 129.go.kr describes it as 24-hour, while the MOHW page gives no hours. Add 24시간 only after the release check. |
| **129** | 보건복지상담센터 | Weekdays 09:00-18:00, emergency counselling 24 hours |
| **112, 119** | 지금 위험할 때 | Immediate danger |
| **마들랜** | 온라인 상담 | For people who cannot phone. State no hours: those details come only from a citizen reporter piece. |

Do not show 1393, which is retired.

For less urgent steps, offer 지역 정신건강복지센터, 대학 상담센터, 심리상담 바우처 and 정신건강의학과 (S21). An urgent suicide crisis is outside the voucher, because psychiatric care comes first (S21).

No verified youth line is in this evidence set. Find one before serving under-18s.

### Words

| Avoid | Source |
|---|---|
| 번아웃 진단, 번아웃 예측, 번아웃 예방, 우울증 위험, 치료, 증상 개선, 정상/비정상, 위험 수치 | S4 |
| 번아웃 지수, 번아웃 점수 | S4, by extension |
| 임상적으로 검증, anything implying a clinical test | S6 |
| Disease names in any prompt | S8 |
| 불안 추적, anxiety tracking | S9 |
| 고위험, 중위험, 저위험, 안전합니다 | S19 |
| 곧, N일 남음, 무너짐, 한계선, anything implying collapse | S15 |
| 스트레스가 줄어듭니다, any claim that tracking reduces stress | S16 |
| 위험, 경고 | **Product choice**. Not decisive alone under S4, but not needed here. |

Prefer 오늘의 부하와 회복, 내 평소와 비교, 쉬어가기 제안, 패턴을 알아차리기 (S4, S16).

### Notifications

- Off by default. At most one reminder a day, at a time the user picks, with fixed neutral text (S25).
- Never about a flag, score, band, mark, missed day or streak (S25, PER-I24).
- No morning bad-news summaries (S17). The weekly review stays in the app.
- No streaks or badges (S24). Missed streaks may add guilt.
- Do not depend on notifications: PWA delivery is less reliable (S25).
- After 7 ignored reminders, stop and ask once. **Product choice** to limit nagging.

### Before launch

1. Have counsel review everything. Nothing here is legal advice.
2. Review all copy, including store text, website and social posts, for an everyday stress, sleep and energy purpose. A disclaimer is unlikely to offset medical claims elsewhere (S1). Article 26(7) of the Medical Devices Act covers misleading labelling and advertising (S6).
3. Do not build a report for a doctor, or feed clinical care, without review (S2). Consider a formal review under Article 60 (S1).
4. Do not describe the app as detecting crisis or danger (S3).
5. Audit the PWA for host logs, analytics, fonts and third-party scripts before saying records stay on the phone. Crash reports could change the analysis (S11).
6. Tell users that clearing browser data deletes records and that anyone holding the phone can read them (S11). Treat daily ratings as sensitive (S10). Any backup or sync needs legal advice first (S10).
7. Recheck the digital health designation list at least yearly (S7).
8. Check PIPA Act 21910 (S10) and the in-force wording of Article 26(7) (S6).
9. Set an age policy. **Product choice**: 14+ for now, because under-14 consent was not researched.

---

## 7. Top open risks and what remains unproven

| # | Risk | What is unproven | Response |
|---|---|---|---|
| 1 | The estimate may have no relation to burnout | No study tested a personalised burnout threshold on self-logged data. No gold standard exists (INS-I5). | Keep the claim narrow. Never call it validated. |
| 2 | Marks are few and noisy | No study of self-marked burnout events was found. Whether people can date them is unknown. Borrowed evidence comes from schizophrenia and depression (PER-I16, PER-I17). | Population default stays in place. Treat marks as labels only. |
| 3 | Most flags will not precede anything | Positive predictive value is likely low (PER-I17). My false-flag figures are synthetic. | Word flags as "higher than usual". Track outcomes on the device. |
| 4 | Too few users reach personalization | Median day-30 retention 3.3%, trackers 6.1% (PER-I21, S23) | Defaults must stand alone. Do not judge the method on those who stay. |
| 5 | The baseline may be wrong | People may install during a bad stretch (PER-I4). A 14-28 day baseline cannot give a known false alarm rate (PER-I7). | Provisional baseline, guard window, new-normal prompt. |
| 6 | Missing days carry meaning | Evidence conflicts on whether people skip when low (PER-I20, S25). | Show unknown. Never impute. |
| 7 | Monitoring may harm some users | Thin evidence. Rumination, foreboding and health anxiety were reported in depression samples (S14, S15). No study tests months of tracking in healthy adults (S16). No study tests telling someone they are burned out (S17, S18). | Hide, pause and reset. Ask every 4 weeks. The team will not see harm rates, so say so honestly (S14). |
| 8 | Constants are unvalidated | Weights, λ, θ, the 14-day guard and the hard-day rule are choices. EWMA on human self-report has no published validation (PER-I8, PER-I9). | Keep them in one file. Replay consented logs before changing them. |
| 9 | Korean and role fit is unknown | No Korean norms for BAT, CBI or PSS. Developers were not studied in any source. No validated Korean daily exhaustion measure. Student evidence is thin. Thresholds moved between neighbouring European countries (INS-I13). | Rely on within-person change. |
| 10 | Meaning of ratings may drift | Whether a person's "4 out of 5" shifts over months is unknown. | Offer 다시 시작. Avoid year-long comparisons in v1. |
| 11 | Legal position is inferred | No MFDS ruling on a burnout index, stress score or personal threshold (S4). No PIPC ruling on on-device apps (S10). Labor law text was seen third-hand (THR-I10). The 2026 PIPC guideline was seen through law-firm summaries (S11). | Pre-launch review. Keep worker notes gated until the wording is confirmed. |
| 12 | Licence gaps | CBI Korean rights are unresolved (INS-I6, INS-I9). The official K-BAT file matches Cho's pre-analysis translation (21 of 22 retained items identical, item 3 differs by one particle), but no source says whether Cho or KSIOP hold rights in the Korean wording, and the article is CC BY-NC 4.0 (INS-I26). | Ask Cho, the Korea consortium member, before a wide launch. Remove 한 달 체크 if the answer is no. |
| 13 | Data loss on the phone | localStorage can be cleared. Whether a plain user export raises any issue was not resolved (S2). | Warn users. Decide on a plain export with counsel. |
| 14 | Load is under-recorded | Only logged minutes count. The hours evidence covers paid work only (THR-I7). | Worker notes are opt-in and labelled as logged hours. |

**First validation step, once volunteers agree:** replay exported logs through `derive` and measure flags per year, marks caught, and the "same as yesterday" baseline before changing any constant.