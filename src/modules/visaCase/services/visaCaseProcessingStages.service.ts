import type { Role } from "../../../types/role";
import {
  formatProcessingLabel,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_TO_TEAM,
  SUB_STATUS_LABELS,
  TEAM_PROCESSING_STAGES,
  toDisplayAssignedTeam,
  type DisplayAssignedTeam,
  type VisaProcessingStage,
} from "../constants/visaCase.constants";
import {
  canRoleUpdateStage,
  stageForSubStatus,
  SUB_STATUS_BY_STAGE,
  type VisaProcessingSubStatus,
} from "./visaCaseStateMachine";

export type ProcessingSubStatusOption = {
  value: VisaProcessingSubStatus;
  label: string;
  displayLabel: string;
  stage: VisaProcessingStage;
  stageLabel: string;
};

export type ProcessingStageOption = {
  stage: VisaProcessingStage;
  label: string;
  team: DisplayAssignedTeam;
  subStatuses: ProcessingSubStatusOption[];
};

export type ProcessingTeamView = {
  team: DisplayAssignedTeam;
  label: string;
  stages: VisaProcessingStage[];
  subStatuses: ProcessingSubStatusOption[];
};

const OPS_TEAM_LABELS: Record<DisplayAssignedTeam, string> = {
  cx: "CX",
  binding: "Binding",
};

const buildSubStatusOption = (
  subStatus: VisaProcessingSubStatus
): ProcessingSubStatusOption => {
  const stage = stageForSubStatus(subStatus);

  return {
    value: subStatus,
    label: SUB_STATUS_LABELS[subStatus] ?? subStatus,
    displayLabel: formatProcessingLabel(stage, subStatus),
    stage,
    stageLabel: STAGE_LABELS[stage],
  };
};

const buildStageOption = (stage: VisaProcessingStage): ProcessingStageOption => ({
  stage,
  label: STAGE_LABELS[stage],
  team: toDisplayAssignedTeam(STAGE_TO_TEAM[stage]) ?? "binding",
  subStatuses: SUB_STATUS_BY_STAGE[stage].map(buildSubStatusOption),
});

const buildTeamView = (team: DisplayAssignedTeam): ProcessingTeamView => {
  const stages = [...TEAM_PROCESSING_STAGES[team]];
  return {
    team,
    label: OPS_TEAM_LABELS[team],
    stages,
    subStatuses: stages.flatMap((stage) =>
      SUB_STATUS_BY_STAGE[stage].map(buildSubStatusOption)
    ),
  };
};

const roleToOpsTeam = (role: Role): DisplayAssignedTeam | null => {
  if (role === "cx") return "cx";
  if (role === "binding" || role === "application") return "binding";
  return null;
};

const updatableSubStatusesForRole = (role: Role): ProcessingSubStatusOption[] => {
  if (role === "developer") {
    return STAGE_ORDER.flatMap((stage) =>
      SUB_STATUS_BY_STAGE[stage].map(buildSubStatusOption)
    );
  }

  return STAGE_ORDER.filter((stage) => canRoleUpdateStage(role, stage)).flatMap(
    (stage) => SUB_STATUS_BY_STAGE[stage].map(buildSubStatusOption)
  );
};

export const getVisaCaseProcessingStages = (viewerRole?: Role) => {
  const stages = STAGE_ORDER.map(buildStageOption);
  const teamViews = {
    cx: buildTeamView("cx"),
    binding: buildTeamView("binding"),
  };

  const viewerTeam = viewerRole ? roleToOpsTeam(viewerRole) : null;

  return {
    stages,
    teamViews,
    viewer: viewerRole
      ? {
          team: viewerTeam,
          teamView: viewerTeam ? teamViews[viewerTeam] : null,
          updatableSubStatuses: updatableSubStatusesForRole(viewerRole),
        }
      : null,
  };
};
