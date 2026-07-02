import { mergePaths } from "../../utils/routeBuilder";
import { automationPaths } from "./automation.paths";
import { checklistPaths } from "./checklist.paths";
import { clientPortalPaths } from "./clientPortal.paths";
import { clientDocumentsPaths } from "./clientDocuments.paths";
import {
  clientPaymentsPaths,
  clientProductPaymentsPaths,
  clientsPaths,
  modulePaymentsModulesPaths,
  modulePaymentsPaths,
} from "./clients.paths";
import { moduleCountriesPaths } from "./countries.paths";
import { journeyPaths } from "./journey.paths";
import { moduleReportsPaths } from "./moduleReports.paths";
import { moduleStagesPaths } from "./stages.paths";
import { visaCasePaths } from "./visaCase.paths";
import {
  activityLogsPaths,
  dashboardPaths,
  leaderboardPaths,
  managerTargetsPaths,
  telecallerTargetsPaths,
} from "./dashboard.paths";
import { frontDeskPaths, leadRegistrationPaths, leadsPaths } from "./leads.paths";
import {
  incentivesPaths,
  maintenancePaths,
  otherProductsPaths,
  ruleConfigurationsPaths,
} from "./misc.paths";
import {
  allFinancePaths,
  googleSheetsPaths,
  messagesPaths,
  reportsPaths,
} from "./reports.paths";
import { rolesPaths } from "./roles.paths";
import {
  leadTypesPaths,
  saleTypeCategoriesPaths,
  saleTypesPaths,
} from "./saleTypes.paths";
import { systemPaths } from "./system.paths";
import { teamsPaths } from "./teams.paths";
import { techSupportPaths } from "./techSupport.paths";
import { usersPaths } from "./users.paths";

/**
 * v1 API paths — mirrors all route modules mounted in `src/index.ts`.
 * Add a new `*.paths.ts` file here when introducing a new route module.
 */
export const v1Paths = mergePaths(
  systemPaths,
  usersPaths,
  rolesPaths,
  teamsPaths,
  saleTypesPaths,
  saleTypeCategoriesPaths,
  leadTypesPaths,
  clientsPaths,
  clientPaymentsPaths,
  clientProductPaymentsPaths,
  modulePaymentsPaths,
  modulePaymentsModulesPaths,
  moduleCountriesPaths,
  journeyPaths,
  moduleReportsPaths,
  visaCasePaths,
  moduleStagesPaths,
  leadsPaths,
  leadRegistrationPaths,
  frontDeskPaths,
  dashboardPaths,
  activityLogsPaths,
  leaderboardPaths,
  managerTargetsPaths,
  telecallerTargetsPaths,
  reportsPaths,
  messagesPaths,
  googleSheetsPaths,
  allFinancePaths,
  checklistPaths,
  clientPortalPaths,
  clientDocumentsPaths,
  automationPaths,
  techSupportPaths,
  maintenancePaths,
  incentivesPaths,
  otherProductsPaths,
  ruleConfigurationsPaths
);
