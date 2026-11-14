export declare function involvementPath(workspace: string, session: string): string;
export declare function readInvolvement(workspace: string, session: string): Promise<string | undefined>;
export declare function writeInvolvement(workspace: string, session: string, change: string): Promise<void>;
