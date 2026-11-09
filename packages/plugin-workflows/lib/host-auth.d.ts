/**
 * The host key that authenticates workflow approvals, receipts, and run files.
 * It lives outside the workspace `.dsh` tree, is never exposed to the model,
 * and is read or created once per host. An approval or receipt that a model
 * writes can therefore never carry a valid signature.
 */
/** Environment override: 64 hex characters. */
export declare const HOST_KEY_ENV = "DSH_WORKFLOWS_HOST_KEY";
/** The default host key location, outside every workspace. */
export declare function defaultHostKeyFile(): string;
/** A trusted HMAC-SHA256 signer over a bounded payload. */
export declare class HostAuth {
    private readonly key;
    private constructor();
    /** Build a signer from an explicit key; tests use this seam. */
    static fromKey(key: string | Buffer): HostAuth;
    /** Load the host key, creating one atomically when it does not exist. */
    static load(options?: {
        keyFile?: string;
        env?: NodeJS.ProcessEnv;
    }): Promise<HostAuth>;
    /** Sign one domain-separated payload. */
    sign(domain: string, payload: unknown): string;
    /** Verify a signature; a missing, short, or forged value is simply false. */
    verify(domain: string, payload: unknown, signature: unknown): boolean;
}
