export type EnrollmentState = {
  factorId?: string;
  message: string;
  qrCode?: string;
  secret?: string;
  status: "idle" | "ready" | "error";
};

export type VerificationState = {
  message: string;
  status: "idle" | "error";
};

export const initialEnrollmentState: EnrollmentState = {
  message: "",
  status: "idle"
};

export const initialVerificationState: VerificationState = {
  message: "",
  status: "idle"
};
