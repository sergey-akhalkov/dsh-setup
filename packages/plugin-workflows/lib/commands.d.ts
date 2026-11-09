/**
 * The `/workflows` user command. It is the user-started path: it can open the
 * view, start a run, resume, install a definition after confirmation, adopt an
 * existing change, or print a bounded status. A display-only action starts
 * nothing, and the model has no access to this module.
 */
export interface WorkflowInstallConfirmation {
    readonly question: string;
    readonly accepted: readonly string[];
    readonly timeoutAction: 'block' | 'cancel';
}
export interface WorkflowCommandQuestions {
    ask(request: WorkflowInstallConfirmation): Promise<{
        answer?: string;
        timedOut?: boolean;
    }>;
}
export interface WorkflowCommandHost {
    readonly workspace: string;
    readonly session: string;
    readonly questions?: WorkflowCommandQuestions;
    /** Open the conversation view; a display-only effect. */
    openView(): string;
    run(definitionId: string): Promise<{
        readonly runId: string;
        readonly firstStep: string;
    }>;
    resume(runId: string): Promise<{
        readonly stepId: string;
    }>;
    install(path: string): Promise<{
        readonly id: string;
    }>;
    adopt(name: string): Promise<{
        readonly ok: boolean;
        readonly reason?: string;
    }>;
    status(): Promise<string>;
}
export type WorkflowCommandResult = {
    readonly kind: 'view';
    readonly text: string;
} | {
    readonly kind: 'result';
    readonly text: string;
} | {
    readonly kind: 'error';
    readonly text: string;
};
/**
 * Run one `/workflows` command line. Installation and adoption ask the user
 * first; a non-affirmative answer writes nothing.
 */
export declare function runWorkflowCommand(input: string, host: WorkflowCommandHost): Promise<WorkflowCommandResult>;
/** A display-only archive parse seam used by the archive gate tests. */
export declare function isArchiveMove(command: string): boolean;
