import type { ModelMessage } from 'ai';

export function shouldPersistResponseMessages(
  responseMessages: ModelMessage[] | null | undefined,
  enableTools: boolean | undefined
) {
  return Boolean(enableTools && responseMessages?.length);
}
