import { Role } from '@prisma/client';

// Auth Phase 5: the practical permission catalogue for this application's
// existing modules. Deliberately scoped to what's already built (not every
// conceivable action) — see the Phase 5 plan for why ATS/Onboarding were
// left out of v1; this list is additive-only for future phases.
export interface PermissionDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  {
    key: 'employee.view',
    name: 'Employee - View',
    description: 'View employee directory and profiles',
    category: 'Employee',
  },
  {
    key: 'employee.create',
    name: 'Employee - Create',
    description: 'Create new employees and send invitations',
    category: 'Employee',
  },
  {
    key: 'employee.update',
    name: 'Employee - Update',
    description: 'Edit employee records',
    category: 'Employee',
  },
  {
    key: 'employee.delete',
    name: 'Employee - Delete',
    description: 'Remove employee records',
    category: 'Employee',
  },

  {
    key: 'attendance.view',
    name: 'Attendance - View',
    description: 'View attendance records',
    category: 'Attendance',
  },
  {
    key: 'attendance.manage',
    name: 'Attendance - Manage',
    description: 'Approve regularizations and import biometric data',
    category: 'Attendance',
  },

  {
    key: 'leave.view',
    name: 'Leave - View',
    description: 'View leave applications and balances',
    category: 'Leave',
  },
  {
    key: 'leave.manage',
    name: 'Leave - Manage',
    description: 'Approve or reject leave applications',
    category: 'Leave',
  },

  {
    key: 'performance.view',
    name: 'Performance - View',
    description: 'View goals, reviews, and evaluations',
    category: 'Performance',
  },
  {
    key: 'performance.manage',
    name: 'Performance - Manage',
    description: 'Manage review cycles and score evaluations',
    category: 'Performance',
  },

  {
    key: 'assets.view',
    name: 'Assets - View',
    description: 'View asset assignments and requests',
    category: 'Assets',
  },
  {
    key: 'assets.manage',
    name: 'Assets - Manage',
    description: 'Assign, reclaim, and approve asset requests',
    category: 'Assets',
  },

  {
    key: 'offboarding.view',
    name: 'Offboarding - View',
    description: 'View resignation and clearance status',
    category: 'Offboarding',
  },
  {
    key: 'offboarding.manage',
    name: 'Offboarding - Manage',
    description: 'Manage clearance checklists and final settlement',
    category: 'Offboarding',
  },

  {
    key: 'helpdesk.view',
    name: 'Helpdesk - View',
    description: 'View helpdesk tickets',
    category: 'Helpdesk',
  },
  {
    key: 'helpdesk.manage',
    name: 'Helpdesk - Manage',
    description: 'Assign and resolve helpdesk tickets',
    category: 'Helpdesk',
  },

  {
    key: 'announcements.view',
    name: 'Announcements - View',
    description: 'View company announcements',
    category: 'Announcements',
  },
  {
    key: 'announcements.manage',
    name: 'Announcements - Manage',
    description: 'Publish and manage announcements',
    category: 'Announcements',
  },

  {
    key: 'analytics.view',
    name: 'Analytics - View',
    description: 'View dashboards and reports',
    category: 'Analytics',
  },
  {
    key: 'analytics.manage',
    name: 'Analytics - Manage',
    description: 'Build, export, and schedule reports',
    category: 'Analytics',
  },

  {
    key: 'workflow.view',
    name: 'Workflow - View',
    description: 'View approval workflows',
    category: 'Workflow',
  },
  {
    key: 'workflow.manage',
    name: 'Workflow - Manage',
    description: 'Configure workflow definitions',
    category: 'Workflow',
  },

  {
    key: 'assistant.use',
    name: 'AI Assistant - Use',
    description: 'Use the AI assistant',
    category: 'AI Assistant',
  },
];

// Sensible starting defaults, mirroring how each role is already treated by
// the rest of the application today. Purely administrative at this point —
// no existing module reads from this table yet.
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: PERMISSION_CATALOG.map((p) => p.key),
  [Role.HR_ADMIN]: [
    'employee.view',
    'employee.create',
    'employee.update',
    'employee.delete',
    'attendance.view',
    'attendance.manage',
    'leave.view',
    'leave.manage',
    'performance.view',
    'performance.manage',
    'assets.view',
    'assets.manage',
    'offboarding.view',
    'offboarding.manage',
    'helpdesk.view',
    'helpdesk.manage',
    'announcements.view',
    'announcements.manage',
    'analytics.view',
    'analytics.manage',
    'workflow.view',
    'workflow.manage',
    'assistant.use',
  ],
  // Mirrors HR_ADMIN's list — this table is purely display-only (see
  // comment above), and HR_ASSOCIATE's actual restriction (no approve/
  // reject/decide authority) is enforced in the guards/services, not
  // representable at this table's view/manage granularity.
  [Role.HR_ASSOCIATE]: [
    'employee.view',
    'employee.create',
    'employee.update',
    'employee.delete',
    'attendance.view',
    'attendance.manage',
    'leave.view',
    'leave.manage',
    'performance.view',
    'performance.manage',
    'assets.view',
    'assets.manage',
    'offboarding.view',
    'offboarding.manage',
    'helpdesk.view',
    'helpdesk.manage',
    'announcements.view',
    'announcements.manage',
    'analytics.view',
    'analytics.manage',
    'workflow.view',
    'workflow.manage',
    'assistant.use',
  ],
  [Role.MANAGER]: [
    'employee.view',
    'attendance.view',
    'leave.view',
    'leave.manage',
    'performance.view',
    'performance.manage',
    'assets.view',
    'helpdesk.view',
    'announcements.view',
    'workflow.view',
    'assistant.use',
  ],
  [Role.EMPLOYEE]: [
    'employee.view',
    'attendance.view',
    'leave.view',
    'performance.view',
    'assets.view',
    'helpdesk.view',
    'announcements.view',
    'assistant.use',
  ],
};
