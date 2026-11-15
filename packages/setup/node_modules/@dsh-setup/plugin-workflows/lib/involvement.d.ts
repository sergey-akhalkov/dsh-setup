export declare function involvementPath(workspace: string, session: string): string;
export declare function readInvolvement(workspace: string, session: string): Promise<readonly string[]>;
export declare function writeInvolvement(workspace: string, session: string, changes: readonly string[]): Promise<void>;
