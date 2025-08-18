import React from "react";
import "./ExampleSidebar.scss";
interface SidePanelProps {
  children: React.ReactNode;
}

export const SidePanel = ({ children }: SidePanelProps) => (
  <div
    className="sidebar sidebar--docked sidebar--right"
    style={{
      position: "absolute",
      top: 0,
      bottom: 0,
      right: 0,
      width: 260,
      overflowY: "auto",
    }}
  >
    <div>Panel 2</div>
    {children}
  </div>
);
