# Candidate document universes for transcripts.fyi

Date: 2026-08-29
Status: research note / shortlist. Verification done with WebSearch + WebFetch on 2026-08-29; anything not verified is marked **[unverified]**.

## Framing

The product is a longitudinal explainer over a *series* of documents about a *recurring subject*. Earnings-call transcripts score well on three axes; every candidate below is judged against the same three:

| Axis | What it means | Earnings calls (baseline) |
|---|---|---|
| Reader pull | Someone actively wants the "what changed" answer and will come back per new doc | High (investors, analysts, employees, journalists) |
| Obtainability | Reliable API / bulk source, licence allows derived summaries, docs fit ~100k chars | Medium (FMP is paid; transcripts are third-party copyrighted) |
| Longitudinal signal | The interesting part is *in the text* and *changes across issues* (guidance vs. delivery, hedging drift, question sharpening) | High |

Requirements: >= 6-8 documents per subject over 2-3 years; series keyed by a stable subject key; new docs discoverable by polling a list endpoint.

## Shortlist (grouped)

### A. Healthcare / medicine

#### A1. FDA drug label (SPL) revision history — subject = one drug (SPL set ID)

1. **Series.** Every prescription label revision. DailyMed keeps every version per set ID; a busy drug (e.g. a GLP-1 or an oncology biologic) gets 3-10 versions/year, so 8+ over 2-3 years is common; sleepy generics may get 1/yr (filter subjects by history length).
2. **Why.** Arcs: Boxed-warning additions and softening; indication expansion (each new approved population); contraindication/interaction changes; dosing-regimen simplification; adverse-reaction table drift as postmarketing data arrives. Reader: pharmacists, clinicians, med-affairs, patients on the drug, biotech investors. "Guidance vs. delivery" analogue: what the sponsor's trials promised (Clinical Studies section) vs. what postmarketing added to Warnings. The aha is a diff timeline of *what the FDA made them say*.
3. **Obtainability.** DailyMed REST v2, no auth, JSON/XML: version list at `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{SETID}/history.json` (docs: https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_setid_history_api.cfm); full SPL XML per version via `/spls/{SETID}.xml?version=N` [param name unverified; history API verified]. openFDA `drug/label` (https://open.fda.gov/apis/drug/label/) returns current labels as JSON, weekly refresh, but does not clearly expose prior versions — use DailyMed for history. US-government work, public domain; no licence problem for derived summaries. Size: full PI labels are 60k-250k chars of XML; strip to text and section-chunk (Boxed Warning, Indications, W&P, AE, Clinical Studies) — a per-section diff tool is the right shape anyway.
4. **Demo feasibility.** Hours. Tools: `label_versions(setid)`, `label_section(setid, version, section)`, `label_diff(setid, v_from, v_to, section)` (server-side text diff so the agent reads deltas, not 8 full labels).
5. **Risks.** No PII. Labels are dense and legalistic; explainer must translate. Set IDs change on some relabels (NDC/labeler changes) — subject key should be the drug + current set ID with an alias list. Interesting changes are sometimes one sentence in a 200k-char doc: diff tool is essential.

#### A2. FDA advisory-committee meeting transcripts — subject = one committee (e.g. ODAC, VRBPAC)

1. **Series.** Verbatim transcripts per meeting, posted ~10-12 weeks after (https://www.fda.gov/advisory-committees/about-advisory-committees/common-questions-and-answers-about-fda-advisory-committee-meetings). ODAC/VRBPAC meet 3-6x/yr, so 8+ over 2 years per committee; per *drug* only 1-2 meetings, so the subject must be the committee (or a therapeutic area).
2. **Why.** Arcs: how the committee's bar shifts (surrogate endpoints vs. OS; accelerated-approval scepticism), which FDA reviewers' concerns recur, voting-pattern drift, sponsor rhetoric vs. FDA presentation. Reader: biotech analysts, regulatory-affairs, clinicians. Aha: "the committee's tolerance for single-arm trials has been narrowing since meeting X."
3. **Obtainability.** Materials pages per committee (https://www.fda.gov/advisory-committees/committees-and-meeting-materials) and https://www.fda.gov/advisory-committees/recently-updated-advisory-committee-materials; transcripts are PDF, 250-450 pages -> 500k-900k chars: needs chunking by session/speaker. No API; HTML scraping of the materials page + PDF-to-text. Public domain. Direct fetch of fda.gov returned 404/403 to our fetcher — expect bot blocking; scrape politely or mirror.
4. **Demo feasibility.** Half a day: scraper is brittle, PDFs need OCR-free text extraction (they are text PDFs). Tools: `adcom_meetings(committee)`, `adcom_transcript_chunk(meeting_id, part)`, `adcom_briefing_docs(meeting_id)`.
5. **Risks.** Long lag (3 months) kills "new doc just dropped" freshness; sizes; scraping fragility. Signal is real but drowned in procedural text.

#### A3. ClinicalTrials.gov record change history — subject = one trial (NCT ID)

1. **Series.** Each edit to a registered trial is versioned; pivotal trials accumulate 10-40 versions over their life.
2. **Why.** The classic integrity story: primary-outcome switching, enrollment-target cuts, completion-date slips, arm changes after unblinding. Reader: meta-researchers, journalists, investors watching a readout. Aha: "the primary endpoint changed 2 months before results posted."
3. **Obtainability.** API v2 (https://clinicaltrials.gov/data-api/about-api, base `https://clinicaltrials.gov/api/v2`, no key) returns current records as JSON; NLM bulletin: https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html. Per-version history is exposed on the site's History tab and the R package `cthist` (https://mirror.linux.duke.edu/pub/cran/web/packages/cthist/cthist.pdf) pulls it; **[unverified]** whether v2 API has a documented per-NCT versions endpoint — the `/version` endpoint found in docs appears to be the *API* version, not record history. Public domain. A record is 20-80k chars JSON: fits.
4. **Demo feasibility.** Hours if using the same undocumented history endpoint cthist uses; otherwise a day. Tools: `trial_versions(nct)`, `trial_version(nct, n)`, `trial_diff(nct, a, b)`.
5. **Risks.** Structured data, not prose — the agent adds value by narrating, but a plain diff view competes well. Changes are sparse and mostly administrative; need a filter for "material" fields.

#### A4. CDC ACIP meeting minutes — subject = the committee (or one vaccine)

1. **Series.** 3-4 meetings/yr, summary minutes 90-120 days later (https://cdc.gov/acip/meetings/minutes.html), 90-120 pages each; slides posted immediately (https://www.cdc.gov/acip/meetings/index.html).
2. **Why.** Especially in 2025-26: membership turnover, changed evidence frameworks, recommendation reversals, votes. Arcs per vaccine: how the risk/benefit framing moved meeting to meeting. Reader: public-health, pediatricians, journalists. High topical pull.
3. **Obtainability.** PDFs on cdc.gov and CDC Stacks (https://stacks.cdc.gov); no API; public domain. 100-page PDFs = 250-400k chars: chunk. Fetcher got 403 from cdc.gov; scraping needs UA care.
4. **Demo feasibility.** Half day. Tools: `acip_meetings()`, `acip_minutes_chunk(meeting, part)`, `acip_slides(meeting)`.
5. **Risks.** Politically sensitive; long lag; minutes are summaries, not verbatim.

#### A5. WHO Disease Outbreak News — subject = one outbreak/pathogen

1. **Series.** HTML items, several per month for an active outbreak (https://www.who.int/emergencies/disease-outbreak-news); a 2-year outbreak yields 10-30 items.
2. **Why.** Case-count curve vs. WHO risk assessment wording; when "low" became "moderate"; recommendation drift (travel/trade). Reader: epi, travel med, journalists.
3. **Obtainability.** HTML, each 5-15k chars (fits easily). WHO content licence is CC BY-NC-SA 3.0 IGO (https://who.int/about/licensing/rss/en) — **non-commercial**: a problem for a commercial product's derived summaries. RSS exists per WHO policy pages [feed URL unverified].
4. **Demo feasibility.** Hours. Tools: `don_list(query)`, `don_item(id)`.
5. **Risks.** NC licence; the interesting signal (numbers) is already a chart elsewhere.

Dropped: hospital community-benefit reports (annual only, PDFs, weak reader pull); drug-shortage notices (too terse).

### B. Science

#### B1. arXiv version history + an author's paper series — subject = arXiv ID or author

1. **Series.** Per paper: v1..vN (typically 2-5 — too few alone). Per author/lab: 6-20 papers over 2 years — the better subject. Or per topic query.
2. **Why.** Per author: claim inflation/deflation across versions, which baselines got added after reviews, how the group's method line evolves, benchmarks retired. Reader: researchers tracking a lab, PhD students, ML-twitter. Aha: "the headline number dropped 3 points between v1 and v3 and the abstract stopped saying 'state of the art'."
3. **Obtainability.** Verified: arXiv API (https://info.arxiv.org/help/api/basics.html, Atom, no key, 3s courtesy delay), OAI-PMH v2 (https://oaipmh.arxiv.org/oai), bulk via S3 (https://info.arxiv.org/help/bulk_data/index.html); version list on abs page (https://info.arxiv.org/help/versions.html); full text per version at `arxiv.org/pdf/{id}v{n}`. Licences vary per paper (many CC BY, some arXiv non-exclusive) — summaries are fine; redistributing full text may not be. Paper 40-120k chars: borderline, chunk by section.
4. **Demo feasibility.** Hours. Tools: `arxiv_author_papers(query)`, `arxiv_versions(id)`, `arxiv_fulltext(id, version, section?)`.
5. **Risks.** PDF extraction noise; per-paper series too short; needs author disambiguation.

#### B2. OpenReview review/rebuttal threads — subject = one venue track or one author across years

1. **Series.** Per paper: reviews + rebuttal + meta-review (one cycle, ~5-15 notes) — a thread, not longitudinal. Per author/lab across ICLR/NeurIPS cycles: 6-15 threads over 2-3 years.
2. **Why.** How reviewers' recurring objections to a line of work evolved; rebuttal strategy; score drift. Reader: researchers. Pull is niche but intense.
3. **Obtainability.** API v2 public for public venues (https://docs.openreview.net/how-to-guides/data-retrieval-and-modification/how-to-get-all-notes-for-submissions-reviews-rebuttals-etc); Python client; `get_all_notes(forum=...)`. ToS on redistribution **[unverified]**. Threads 20-60k chars: fit.
4. **Demo feasibility.** Hours. Tools: `openreview_forums(author|venue)`, `openreview_thread(forum_id)`.
5. **Risks.** Only ML venues; anonymised reviewers; author-level subject is the weak link.

#### B3. NIH RePORTER grant renewals — subject = one core project number

1. **Series.** One abstract + public-health statement per fiscal year plus renewals/supplements: 3-8 docs over years, plus linked publications.
2. **Why.** Promised aims vs. published output; drift in framing. Reader: program officers, competing labs.
3. **Obtainability.** API verified (https://api.reporter.nih.gov/, no key, <=1 req/s, 500/page); abstracts yes, **progress reports (RPPR) are not public** — the interesting document is missing. Public domain. Abstracts <10k chars.
4. **Demo.** Hours, but: 5. **Risks.** Weak — the longitudinal text is thin and mostly repeats. Drop unless paired with PubMed output.

Dropped: IPCC cycles (7-year cadence), Nobel lectures (one per laureate), conference Q&A (no reliable transcript source).

### C. Policy / civic

#### C1. FOMC press-conference transcripts + minutes — subject = the Fed (or the Chair)

1. **Series.** 8 meetings/yr; per meeting: statement (day 0), press-conference transcript PDF (day 0-1), minutes (3 weeks later). 24+ docs over a year; 16 pressers over 2 years.
2. **Why.** This *is* earnings calls for the macro economy. Arcs: forward guidance vs. what they did; balance-of-risks language drift; reporters' questions sharpening; the Powell -> Warsh transition in 2026 (transcripts exist for both: https://www.federalreserve.gov/mediacenter/files/FOMCpresconf20260429.pdf, https://www.federalreserve.gov/mediacenter/files/FOMCpresconf20260617.pdf). Reader: anyone with a mortgage, plus every macro desk. Aha: "the word 'transitory' appeared in 4 straight pressers, then vanished."
3. **Obtainability.** Verified: PDFs at predictable URLs `federalreserve.gov/mediacenter/files/FOMCpresconf{YYYYMMDD}.pdf`; minutes/statements HTML at https://www.federalreserve.gov/monetarypolicy/fomc_historical.htm and the yearly calendar page; Fed publishes RSS feeds (press releases) [specific feed URL unverified]. US-government work: public domain. Presser transcript ~25 pages = 60-80k chars: fits; minutes 40-60k chars: fits.
4. **Demo feasibility.** Two hours. Tools: `fomc_meetings()`, `fomc_document(date, kind: statement|presser|minutes)`. Optional `fomc_dotplot(date)` (SEP tables) for guidance-vs-delivery numerically.
5. **Risks.** Single subject (one series) — but ECB, BoE, BoJ are parallel: ECB press conference with Q&A is HTML (https://www.ecb.europa.eu/press/press_conference/monetary-policy-statement/html/index.en.html), which makes "central bank" a subject kind with 4+ subjects. Extremely well-covered by media; explainer must beat Bloomberg's "Fed decoder".

#### C2. Central bankers' speeches (BIS collection) — subject = one official

1. **Series.** BIS aggregates speeches from all central banks (https://www.bis.org/cbspeeches/index.htm), RSS at https://www.bis.org/doclist/cbspeeches.r, bulk full-text download since 1996 (https://bis.org/cbspeeches/download.htm). A Fed governor gives 10-25 speeches/yr.
2. **Why.** Per official: hawk/dove drift, when they broke from the committee, topics adopted/abandoned. Reader: rates traders, Fed-watchers.
3. **Obtainability.** Verified list/RSS/bulk; PDFs 15-40k chars: fit. BIS terms: non-commercial use of the collection; original speeches are mostly public domain (Fed) or central-bank copyright — fetch from origin for commercial use.
4. **Demo.** Hours. Tools: `speeches_by_speaker(name)`, `speech_text(id)`.
5. **Risks.** BIS NC terms; speeches are prepared remarks (less candid than Q&A).

#### C3. Supreme Court oral arguments — subject = one Justice (or one recurring litigant / doctrine)

1. **Series.** ~60 arguments/term; per Justice, every argument they sit in — filter by topic (e.g. "administrative law") to get 8-15/yr.
2. **Why.** How a Justice's questioning on a doctrine evolves; which hypotheticals recur; tone toward the SG. Reader: SCOTUS-watchers, law students, litigators prepping. Aha: "Justice X has asked the same major-questions hypothetical in 5 arguments and it landed in 2 opinions."
3. **Obtainability.** Official transcripts: PDF on supremecourt.gov (public domain). Oyez has an undocumented JSON API (https://api.oyez.org/cases?per_page=0, `api.oyez.org/case_media/oral_argument_audio/{id}`) with speaker-attributed transcripts (https://github.com/walkerdb/supreme_court_transcripts); Oyez licence for reuse **[unverified]** — prefer official PDFs for production, Oyez for speaker labels. Transcript ~60-100 pages = 100-160k chars: chunk by advocate.
4. **Demo.** Hours via Oyez JSON. Tools: `scotus_arguments(justice|term|topic)`, `scotus_transcript(case_id, part)`, `scotus_speaker_turns(case_id, justice)`.
5. **Risks.** Per-Justice series is a *speaker* series, not a document series — the skill needs the speaker-turns tool. Only Oct-Apr.

#### C4. Congressional hearing transcripts for one agency/witness — subject = agency or recurring witness

1. **Series.** GovInfo CHRG collection (https://www.govinfo.gov/help/chrg), text + PDF, via GovInfo API (https://github.com/usgpo/api, free api.data.gov key). A cabinet secretary or Fed Chair testifies 4-10x/yr; publication lag can be many months.
2. **Why.** Same members ask the same questions; witness answers drift; promises vs. follow-through. Reader: policy staff, journalists.
3. **Obtainability.** Verified collection + API; public domain; text 200-600k chars: chunk by witness/member.
4. **Demo.** Half day. Tools: `hearings(committee|witness)`, `hearing_text(package_id, part)`.
5. **Risks.** Publication lag (months to a year) is the killer for freshness; text is unstructured.

#### C5. City-council items for one project (Legistar) — subject = one matter/file number

1. **Series.** Legistar Web API (https://webapi.legistar.com/Help, OData, no key for most clients) exposes matters, histories, events, attachments for 70% of large US cities. A contentious rezoning accumulates 8-30 actions and attachments over 2 years.
2. **Why.** Local-news gap: what changed in the deal, who flipped votes, staff report vs. final. Reader: residents, local reporters. Pull is strong locally, thin globally.
3. **Obtainability.** Verified API; attachments are PDFs (staff reports 20-200k chars); minutes often PDF. Public records.
4. **Demo.** Hours for metadata; attachments messy. Tools: `matter_history(client, matter_id)`, `matter_attachments(...)`, `event_minutes(client, event_id)`.
5. **Risks.** Per-city variance; interesting part often in video, not text.

#### C6. SEC comment-letter correspondence — subject = one registrant

1. **Series.** UPLOAD (SEC) / CORRESP (company) filings, 2-10 letters per review cycle, cycles every 1-3 years; EDGAR full-text search + per-CIK submissions JSON (https://data.sec.gov), 10 req/s (https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data). Public domain. Letters 5-40k chars.
2. **Why.** Which disclosures the SEC keeps pushing on (revenue recognition, non-GAAP, AI claims); how the company's answers harden. Reader: accountants, short-sellers, IR. Pairs naturally with the existing ticker subject.
3. **Demo.** Two hours, reusing ticker->CIK. Tools: `sec_correspondence(cik)`, `sec_letter(accession)`.
4. **Risks.** Sparse for most companies (need a filter for active cycles); letters posted only after review closes (lag 20+ business days).

### D. Other

#### D1. Release notes / changelog — subject = one product or repo

1. **Series.** GitHub Releases API (https://docs.github.com/en/rest/releases/releases, token, `body` field); or vendor changelog pages/RSS. 10-100 releases over 2 years.
2. **Why.** Roadmap promised vs. shipped, deprecation arcs, breaking-change cadence, what got quietly removed. Reader: developers deciding to upgrade/adopt, competitors, DevRel.
3. **Obtainability.** Trivial for GitHub; release bodies 1-20k chars. Licence: repo licence covers notes; vendor pages vary.
4. **Demo.** One hour. Tools: `releases(repo)`, `release(repo, tag)`, plus `roadmap_issues(repo)` for the promise side.
5. **Risks.** Low novelty (many "changelog digest" bots); pull is moderate.

#### D2. IETF working-group minutes + draft revisions — subject = one WG or one Internet-Draft

1. **Series.** Minutes per session (3 plenaries/yr + interims) on datatracker (e.g. https://datatracker.ietf.org/doc/minutes-interim-2025-iab-04-202502191500/), and draft revisions -00..-NN (10-30 per draft). Datatracker API v1 (https://datatracker.ietf.org/api/v1, JSON, no key for read).
2. **Why.** Which objections blocked consensus and when they dissolved; draft text drift on the contentious section. Reader: protocol engineers, standards-watchers.
3. **Obtainability.** Verified; text/markdown minutes 10-40k chars; drafts 50-200k. Open (IETF Trust).
4. **Demo.** Hours. Tools: `wg_sessions(wg)`, `session_minutes(id)`, `draft_versions(name)`, `draft_diff(name, a, b)` (rfcdiff exists).
5. **Risks.** Niche audience; minutes quality varies.

#### D3. Sports post-game / press-conference transcripts — subject = one coach or player

1. **Series.** ASAP Sports FastScripts (https://www.asapsports.com/archive.php) — free HTML archive for golf, tennis, NFL, NBA, NCAA; 20-80 transcripts/season per subject. Reuse terms **[unverified]**; they are a commercial transcription vendor, assume copyrighted.
2. **Why.** Narrative arcs: excuses vs. accountability, injury-talk drift, "we're close" -> hot seat. Reader: fans, beat writers. Pull is high and fun; explainer aha: "he said 'execution' in 9 straight losses."
3. **Obtainability.** HTML scrape, 5-15k chars each. Licence is the issue.
4. **Demo.** Hours. Tools: `pressers(person)`, `presser(id)`.
5. **Risks.** Copyright; scraping; content is low-density.

#### D4. Long court dockets (RECAP/CourtListener) — subject = one case

1. **Series.** Docket entries + filed documents; a big antitrust case has hundreds of entries over years.
2. **Why.** Motion-by-motion arc, judge's tone in orders, what each side stopped arguing. Reader: legal journalists, litigants' industry.
3. **Obtainability.** CourtListener v4 API (https://wiki.free.law/c/courtlistener/help/api/rest/v4/overview), token; default free throttle is very low (5/min, 50/hr, 125/day) — need a paid/raised tier. Documents public-record; many not yet in RECAP (Pray-and-Pay). PDFs 20-300k chars.
4. **Demo.** A day. Tools: `docket_entries(id)`, `docket_document(id)`.
5. **Risks.** Rate limits; missing docs; PII in filings.

#### D5. Annual shareholder letters — subject = one CEO/company

1. Berkshire archive (https://www.berkshirehathaway.com/letters/letters.html) and others; annual cadence means only 2-3 docs over the window — fails the longitudinal bar unless the window is 10+ years. Drop for demo; good "prestige" series later.

Dropped: podcast episodes (no transcript source with clean licence; audio cost), open-source governance minutes (irregular; overlaps IETF).

## Summary table

| # | Universe | Subject key | Docs / 2 yr | Fits 100k? | API | Licence | Pull | Signal |
|---|---|---|---|---|---|---|---|---|
| A1 | Drug label revisions | SPL set ID | 4-20 | chunk by section | DailyMed v2 | public domain | Med-High | High (diff) |
| A2 | FDA AdCom transcripts | committee | 6-12 | no (500k+) | none, scrape | public domain | Med | Med |
| A3 | ClinicalTrials.gov history | NCT ID | 10-40 | yes | v2 (+history, unverified) | public domain | Med | Med (structured) |
| A4 | ACIP minutes | committee | 6-8 | chunk | none | public domain | High (2026) | Med |
| A5 | WHO DON | outbreak | 10-30 | yes | RSS | CC BY-NC-SA | Med | Low-Med |
| B1 | arXiv author/paper versions | author / arXiv ID | 6-20 | borderline | API/OAI | per-paper | Med | Med |
| B2 | OpenReview threads | author / venue | 6-15 | yes | API v2 | unverified | Low-Med | Med |
| B3 | NIH RePORTER | project no. | 3-8 | yes | API | public domain | Low | Low |
| C1 | FOMC pressers + minutes | central bank | 16-24 | yes | URL pattern | public domain | High | High |
| C2 | Central-bank speeches | official | 20-50 | yes | BIS RSS/bulk | BIS NC / origin PD | Med | Med-High |
| C3 | SCOTUS oral arguments | justice / topic | 8-15/yr | chunk | Oyez JSON (undoc.) / PDF | PD (official) | Med-High | Med-High |
| C4 | Congressional hearings | agency / witness | 8-20 | no | GovInfo API | public domain | Med | Med |
| C5 | Council matter (Legistar) | matter ID | 8-30 | mixed | Legistar API | public record | Local-High | Med |
| C6 | SEC comment letters | CIK | 2-10 | yes | EDGAR | public domain | Med | High when present |
| D1 | Release notes | repo | 10-100 | yes | GitHub API | repo licence | Med | Med |
| D2 | IETF WG minutes/drafts | WG / draft | 6-30 | mostly | Datatracker | open | Low-Med | Med-High |
| D3 | Sports pressers | coach / player | 20-80 | yes | scrape | copyrighted | High | Med |
| D4 | Court docket | case | 50-500 | mixed | CourtListener | PD, throttled | Med | Med |

## Ranked top 5 for a demo

1. **C1 FOMC press conferences + minutes (subject kind: `central_bank`).** The closest structural twin to earnings calls — Q&A, guidance vs. delivery, hedging drift — with a far larger audience and zero licensing/API cost. vs. earnings: (a) pull higher, (b) obtainability much better (public domain, fixed URLs, fits 100k), (c) signal equal. Weakness: few subjects; fix by adding ECB/BoE/BoJ as sibling subjects the same day.
2. **A1 Drug label revision history (`drug_label`).** Best healthcare fit: true versioned document, public-domain, clean API, thousands of subjects, and the explainer output ("what the FDA made them say, and when") does not exist as a product. vs. earnings: (a) pull medium (narrower but sticky, clinical), (b) obtainability better, (c) signal high but needs a diff tool because deltas are small in huge docs.
3. **C3 Supreme Court oral arguments per Justice (`scotus_justice`).** Distinct, high-interest, speaker-turn longitudinal series with public-domain transcripts. vs. earnings: (a) pull comparable among a legal/political audience, (b) obtainability good but relies on undocumented Oyez JSON or PDF parsing + speaker segmentation, (c) signal high but is *per speaker*, requiring the turns tool.
4. **C6 SEC comment-letter correspondence (`sec_registrant`).** Cheapest add because it reuses the ticker subject; a strong "second lens" demo of the same subject inside the existing universe. vs. earnings: (a) pull lower (niche, accounting), (b) obtainability better (public domain, tiny docs), (c) signal excellent when a review cycle exists, absent otherwise.
5. **A4 ACIP minutes (`advisory_committee`)** — highest topical pull in healthcare right now, public domain; loses points for 90-120 day lag, PDF chunking, and no API. vs. earnings: (a) pull high (2026 news cycle), (b) obtainability worse (scrape, size), (c) signal medium (summary minutes, not verbatim).

Honorable: D1 release notes (fastest to wire, weakest wow), A3 ClinicalTrials history (great story, needs unverified history endpoint), C2 speeches (good per-official series; NC terms via BIS).

## What generalizes: data model check

| Kind (`subjects.kind`) | `subjects.key` | Skill (markdown) | Toolset (2-3 tools) | New-doc trigger |
|---|---|---|---|---|
| `central_bank` | `fed`, `ecb`, `boe` | `central-bank-cycle.md`: statement vs. presser vs. minutes; guidance ledger; question-sharpening | `cb_meetings(bank)`, `cb_document(bank, date, kind)` | poll meetings list after each scheduled decision date |
| `drug_label` | SPL set ID (+aliases) | `label-revisions.md`: section-wise diff narration; boxed-warning/indication/W&P ledger | `label_versions`, `label_section`, `label_diff` | poll `/history` weekly |
| `scotus_justice` | justice slug (+optional topic) | `justice-questioning.md`: recurring hypotheticals, doctrine arcs, tone | `scotus_arguments`, `scotus_speaker_turns`, `scotus_transcript` | poll term argument calendar |
| `sec_registrant` | CIK | `comment-letters.md`: issue ledger across cycles, hardening of answers | `sec_correspondence`, `sec_letter` | poll submissions JSON for UPLOAD/CORRESP |
| `advisory_committee` | `acip`, `odac`, `vrbpac` | `committee-minutes.md`: vote/recommendation ledger, framework drift, membership | `committee_meetings`, `minutes_chunk`, `slides` | poll meetings page |

All five keep `runs = subject x skill -> one session` and append-only `artifacts`. Two generalisations the earnings demo did not need: (1) a **server-side diff tool** for versioned-document kinds (labels, drafts, trial records) so the agent reads deltas; (2) a **chunk/part parameter** on fetch tools for >100k-char PDFs (AdCom, ACIP, hearings, arguments). Both are toolset-level, not schema-level, so the data model holds.

## Unverified items (need a manual check before building)

- ClinicalTrials.gov: existence/shape of a per-NCT version-history endpoint in API v2 (cthist uses the site's history tab).
- DailyMed: exact parameter for fetching a *specific prior* SPL version's XML (history list is verified).
- Oyez API licence / ToS for reuse; ASAP Sports reuse terms; OpenReview ToS for derived content.
- Federal Reserve RSS feed URL for FOMC materials (documents themselves verified).
- WHO DON RSS feed URL (licence verified as CC BY-NC-SA).
- fda.gov / cdc.gov returned 403/404 to automated fetch; scraping viability untested.
