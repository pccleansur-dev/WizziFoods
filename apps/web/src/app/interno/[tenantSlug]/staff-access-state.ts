export type StaffAccessState = {
  message: string;
  status: "idle" | "error";
};

export const initialStaffAccessState: StaffAccessState = {
  message: "",
  status: "idle"
};
