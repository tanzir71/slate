import { useState } from "react";
import { isIsoDate } from "@slate/core";
import { WorkspaceDialog } from "./browser/WorkspaceDialog";
import "./datePicker.css";

export function DatePicker({
  initialDate,
  onChoose,
  onClose,
}: {
  initialDate: string;
  onChoose(date: string): boolean;
  onClose(): void;
}) {
  const [date, setDate] = useState(initialDate);
  const [error, setError] = useState("");
  return (
    <WorkspaceDialog
      title="Insert date"
      onClose={onClose}
      className="dateDialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!isIsoDate(date)) {
            setError("Choose a valid calendar date.");
            return;
          }
          if (!onChoose(date))
            setError(
              "This date could not be inserted. Close the picker and try again.",
            );
        }}
      >
        <label>
          Date
          <input
            type="date"
            value={date}
            min="0001-01-01"
            max="9999-12-31"
            required
            onChange={(event) => {
              setDate(event.target.value);
              setError("");
            }}
          />
        </label>
        <p>The date is inserted as YYYY-MM-DD.</p>
        {error && <p role="alert">{error}</p>}
        <div className="datePickerActions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dateInsertButton">
            Insert date
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
