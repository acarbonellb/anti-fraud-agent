/** The brief §5 dataset, in its order: problem cases 1–26, then N1–N5. */
import type { EvalCase } from "../../src/evals/types.js";
import { evalCase as case01 } from "./01-bar-sells-past-capacity.js";
import { evalCase as case02 } from "./02-room-sells-past-capacity.js";
import { evalCase as case03 } from "./03-postal-code-other-province.js";
import { evalCase as case04 } from "./04-address-not-a-venue.js";
import { evalCase as case05 } from "./05-new-organizer-stadium-artist.js";
import { evalCase as case06 } from "./06-artist-booked-elsewhere.js";
import { evalCase as case07 } from "./07-clone-of-other-organizer.js";
import { evalCase as case08 } from "./08-description-copied.js";
import { evalCase as case09 } from "./09-poster-of-other-ticketing.js";
import { evalCase as case10 } from "./10-bizum-payment.js";
import { evalCase as case11 } from "./11-link-to-other-ticketing.js";
import { evalCase as case12 } from "./12-no-refund-even-if-cancelled.js";
import { evalCase as case13 } from "./13-outlier-price.js";
import { evalCase as case14 } from "./14-vip-cheaper-than-general.js";
import { evalCase as case15 } from "./15-service-fee-45-percent.js";
import { evalCase as case16 } from "./16-free-with-50000-tickets.js";
import { evalCase as case17 } from "./17-session-hours-after-publishing.js";
import { evalCase as case18 } from "./18-session-three-years-away.js";
import { evalCase as case19 } from "./19-overlapping-sessions.js";
import { evalCase as case20 } from "./20-homoglyph-promoter-name.js";
import { evalCase as case21 } from "./21-owner-with-rejected-organization.js";
import { evalCase as case22 } from "./22-tax-id-wrong-checksum.js";
import { evalCase as case23 } from "./23-previous-fraud-reports.js";
import { evalCase as case24 } from "./24-alcohol-aimed-at-minors.js";
import { evalCase as case25 } from "./25-prompt-injection.js";
import { evalCase as case26 } from "./26-edited-to-ask-for-bizum.js";
import { evalCase as caseN1 } from "./N1-room-of-400-selling-350.js";
import { evalCase as caseN2 } from "./N2-three-day-festival.js";
import { evalCase as caseN3 } from "./N3-small-organizer-bar.js";
import { evalCase as caseN4 } from "./N4-free-charity-event.js";
import { evalCase as caseN5 } from "./N5-new-venue-without-web.js";

export const EVAL_CASES: readonly EvalCase[] = [
  case01,
  case02,
  case03,
  case04,
  case05,
  case06,
  case07,
  case08,
  case09,
  case10,
  case11,
  case12,
  case13,
  case14,
  case15,
  case16,
  case17,
  case18,
  case19,
  case20,
  case21,
  case22,
  case23,
  case24,
  case25,
  case26,
  caseN1,
  caseN2,
  caseN3,
  caseN4,
  caseN5,
];
