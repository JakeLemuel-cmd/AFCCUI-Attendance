import { useContext } from "react";
import { AttendanceTaskContext } from "@/context/AttendanceTaskContext";

export function useAttendanceTask() {
  const context = useContext(AttendanceTaskContext);

  if (!context) {
    throw new Error("useAttendanceTask must be used within an AttendanceTaskProvider");
  }

  return context;
}
