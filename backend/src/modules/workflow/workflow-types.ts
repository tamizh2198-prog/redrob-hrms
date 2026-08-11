import { Role } from '@prisma/client';

// Section 7.15 Key Feature: "each step's approver resolved dynamically."
// ROLE resolves to every employee holding that role in the company (any one
// of them may act on that slot) — there's no per-role "named individual"
// concept in this system beyond Role itself.
export interface ApproverRule {
  type: 'MANAGER' | 'SKIP_MANAGER' | 'ROLE';
  role?: Role; // required when type === 'ROLE'
}

export interface StepCondition {
  field: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
}

// Section 7.15 Key Feature: "Parallel approval support" — a step with more
// than one approverRule and requireAll:true only completes once EVERY rule's
// slot has an APPROVED decision (Offboarding's 4-department use case); a
// single-rule step (or requireAll:false) completes on the first decision.
export interface WorkflowStepDef {
  sequence: number;
  approverRules: ApproverRule[];
  requireAll: boolean;
  slaHours?: number;
  escalationTargetRole?: Role; // defaults to HR_ADMIN if unset
  condition?: StepCondition; // Key Feature: conditional branching
}
