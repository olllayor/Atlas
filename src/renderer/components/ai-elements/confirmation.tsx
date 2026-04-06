"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { ChatToolApproval, ChatToolState } from "../../../shared/contracts";

type ConfirmationContextValue = {
  approval?: ChatToolApproval;
  state: ChatToolState;
};

const ConfirmationData = createContext<ConfirmationContextValue | null>(null);

function useConfirmation() {
  const value = useContext(ConfirmationData);

  if (!value) {
    throw new Error("Confirmation components must be used within <Confirmation>.");
  }

  return value;
}

function isHiddenState(state: ChatToolState) {
  return state === "input-streaming" || state === "input-available";
}

function isAcceptedState(approval: ChatToolApproval | undefined, state: ChatToolState) {
  return approval?.approved === true && (state === "approval-responded" || state === "output-available");
}

function isRejectedState(approval: ChatToolApproval | undefined, state: ChatToolState) {
  return approval?.approved === false && (state === "approval-responded" || state === "output-denied");
}

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ChatToolApproval;
  state: ChatToolState;
};

export const Confirmation = ({
  approval,
  state,
  className,
  children,
  ...props
}: ConfirmationProps) => {
  const value = useMemo<ConfirmationContextValue>(() => ({ approval, state }), [approval, state]);

  if (!approval || isHiddenState(state)) {
    return null;
  }

  const destructive = isRejectedState(approval, state);

  return (
    <ConfirmationData.Provider value={value}>
      <Alert
        variant={destructive ? "destructive" : "default"}
        className={cn(
          "grid-cols-1 gap-0 border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3.5 py-3 text-white",
          className
        )}
        {...props}
      >
        {children}
      </Alert>
    </ConfirmationData.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<typeof AlertTitle>;

export const ConfirmationTitle = ({ className, ...props }: ConfirmationTitleProps) => (
  <AlertTitle className={cn("col-start-1 text-[12px] font-normal text-[var(--text-secondary)]", className)} {...props} />
);

function ConditionalConfirmation({
  children,
  when,
}: {
  children: ReactNode;
  when: boolean;
}) {
  if (!when) {
    return null;
  }

  return <>{children}</>;
}

export type ConfirmationRequestProps = {
  children: ReactNode;
};

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { state } = useConfirmation();
  return (
    <ConditionalConfirmation when={state === "approval-requested"}>
      <AlertDescription className="col-start-1 mt-1 text-[12.5px] leading-5.5 text-[var(--text-tertiary)]">
        {children}
      </AlertDescription>
    </ConditionalConfirmation>
  );
};

export type ConfirmationAcceptedProps = {
  children: ReactNode;
};

export const ConfirmationAccepted = ({ children }: ConfirmationAcceptedProps) => {
  const { approval, state } = useConfirmation();
  return (
    <ConditionalConfirmation when={isAcceptedState(approval, state)}>
      <AlertDescription className="col-start-1 mt-1 flex items-center gap-2 text-[12.5px] leading-5 text-[var(--text-tertiary)]">
        {children}
      </AlertDescription>
    </ConditionalConfirmation>
  );
};

export type ConfirmationRejectedProps = {
  children: ReactNode;
};

export const ConfirmationRejected = ({ children }: ConfirmationRejectedProps) => {
  const { approval, state } = useConfirmation();
  return (
    <ConditionalConfirmation when={isRejectedState(approval, state)}>
      <AlertDescription className="col-start-1 mt-1 flex items-center gap-2 text-[12.5px] leading-5 text-[var(--text-tertiary)]">
        {children}
      </AlertDescription>
    </ConditionalConfirmation>
  );
};

export type ConfirmationActionsProps = HTMLAttributes<HTMLDivElement>;

export const ConfirmationActions = ({
  className,
  children,
  ...props
}: ConfirmationActionsProps) => {
  const { state } = useConfirmation();

  if (state !== "approval-requested") {
    return null;
  }

  return (
    <div className={cn("mt-3 flex items-center gap-2", className)} {...props}>
      {children}
    </div>
  );
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = ({
  className,
  size = "sm",
  ...props
}: ConfirmationActionProps) => (
  <Button
    size={size}
    className={cn("h-8 px-3 text-sm", className)}
    type="button"
    {...props}
  />
);
