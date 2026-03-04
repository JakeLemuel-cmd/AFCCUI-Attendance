import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "@/context/AuthContext";
import { VoterImportProvider } from "@/context/VoterImportContext";
import { AttendanceTaskProvider } from "@/context/AttendanceTaskContext";
import coopVoteLogo from "@/assets/coop-vote-logo-cropped.png";
import App from "./App";
import "./index.css";

const existingFavicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");

if (existingFavicon) {
  existingFavicon.href = coopVoteLogo;
  existingFavicon.type = "image/png";
} else {
  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/png";
  favicon.href = coopVoteLogo;
  document.head.appendChild(favicon);
}

document.title = "Coop Vote";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AttendanceTaskProvider>
        <VoterImportProvider>
          <App />
        </VoterImportProvider>
      </AttendanceTaskProvider>
    </AuthProvider>
  </React.StrictMode>
);
