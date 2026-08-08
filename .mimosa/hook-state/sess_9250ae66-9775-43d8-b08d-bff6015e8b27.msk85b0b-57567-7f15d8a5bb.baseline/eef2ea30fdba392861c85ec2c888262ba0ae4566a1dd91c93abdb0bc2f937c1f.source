import type { ToolExecutionState } from '../../../shared/contracts';
import type { SaveToolExecutionInput, ToolExecutionsRepo } from '../../db/repositories/toolExecutionsRepo';

type UpdateToolExecutionInput = Omit<SaveToolExecutionInput, 'state'> & {
  state: ToolExecutionState;
};

export class ToolStateStore {
  constructor(private readonly toolExecutionsRepo: ToolExecutionsRepo) {}

  save(input: UpdateToolExecutionInput) {
    this.toolExecutionsRepo.save(input);
  }

  markRequestError(requestId: string, errorCode: string, errorMessage: string) {
    this.toolExecutionsRepo.markRequestExecutionsErrored(requestId, errorCode, errorMessage);
  }

  reconcileInterrupted() {
    return this.toolExecutionsRepo.reconcileActiveExecutions();
  }
}

