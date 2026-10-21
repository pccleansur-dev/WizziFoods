export type AccessActionState = {
  message: string;
  status: "idle" | "error" | "success";
};

export const initialAccessState: AccessActionState = {
  message: "",
  status: "idle"
};
