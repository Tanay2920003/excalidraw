import { DefaultSidebar, Sidebar, THEME } from "@excalidraw/excalidraw";
import {
  messageCircleIcon,
  presentationIcon,
} from "@excalidraw/excalidraw/components/icons";
import { LinkButton } from "@excalidraw/excalidraw/components/LinkButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";

import "./AppSidebar.scss";

export const AppSidebar = () => {
  const { theme, openSidebar } = useUIAppState();

  return (
    <DefaultSidebar />
  );
};
