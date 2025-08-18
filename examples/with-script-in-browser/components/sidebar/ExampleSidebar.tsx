import React, { useState } from "react";

import "./ExampleSidebar.scss";

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div>test2</div>
      <div>{children}</div>
    </>
  );
}
