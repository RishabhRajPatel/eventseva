/** The customer's 6-digit handover code, sent only when complete (the server checks it). */
export const customerCode = (raw: string) => (/^\d{6}$/.test(raw) ? { customerCode: raw } : {});
