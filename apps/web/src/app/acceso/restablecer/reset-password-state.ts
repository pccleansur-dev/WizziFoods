export type ResetPasswordState = {
  message: string;
  status: "idle" | "error";
};

export const initialResetPasswordState: ResetPasswordState = {
  message: "",
  status: "idle"
};
