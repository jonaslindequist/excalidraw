import "@excalidraw/excalidraw/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import App from "./components/ExampleApp";

import type * as TExcalidraw from "@excalidraw/excalidraw";
import FactSheetsManager from "./components/FactSheetManager";
import { FactsProvider } from "./facts/FactsContext";
import { ExpandableElementProvider } from "./tools/ExpandableElementShapeContext";

declare global {
  interface Window {
    ExcalidrawLib: typeof TExcalidraw;
  }
}

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
const { Excalidraw } = window.ExcalidrawLib;

root.render(
  <StrictMode>
    <ExpandableElementProvider>
      <FactsProvider>
        <BrowserRouter>
          <header style={{ padding: 16, borderBottom: "1px solid #ccc" }}>
            <Link to="/" style={{ marginRight: 16 }}>
              🖊️ Canvas
            </Link>
            <Link to="/fact-sheets">📄 Fact Sheets</Link>
          </header>

          <Routes>
            <Route
              path="/"
              element={
                <App
                  appTitle="Excalidraw Example"
                  useCustom={(api: any, args?: any[]) => {}}
                  excalidrawLib={window.ExcalidrawLib}
                >
                  <Excalidraw />
                </App>
              }
            />

            {/* Full-screen Fact-Sheet admin at “/fact-sheets” */}
            <Route path="/fact-sheets" element={<FactSheetsManager />} />

            {/* Catch-all → redirect back to “/” */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </FactsProvider>
    </ExpandableElementProvider>
  </StrictMode>,
);
