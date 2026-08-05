import { Injectable, Logger } from '@nestjs/common';

export interface WorkflowInstance {
  id: string;
  workflowType: string;
  entityId: string;
  currentStep: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  // TODO: back this with a workflow_instance table (Section 7.15) once the
  // Workflow module lands; Leave, Assets, Offboarding Clearance, etc. call
  // this same engine instead of each hand-rolling multi-level approval.
  start(workflowType: string, entityId: string): Promise<WorkflowInstance> {
    this.logger.log(`start ${workflowType} for ${entityId}`);
    return Promise.resolve({
      id: '',
      workflowType,
      entityId,
      currentStep: 0,
      status: 'PENDING',
    });
  }

  approveStep(instanceId: string, approverId: string): Promise<void> {
    this.logger.log(`approve ${instanceId} by ${approverId}`);
    return Promise.resolve();
  }

  rejectStep(
    instanceId: string,
    approverId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(`reject ${instanceId} by ${approverId}: ${reason}`);
    return Promise.resolve();
  }
}
