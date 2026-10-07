import { type Accessor, createContext, useContext } from "solid-js";

/**
 * Host capabilities the UI can use on top of the model: native dialogs and
 * other host-side services. Fixture hosts provide none, so the controls that
 * need them are not shown. The UI never reads paths or handles; everything
 * the model needs travels through its own actions.
 */
export type HostServices = {
	/** Opens the native file dialog and imports the picked files. */
	importFromDialog(): Promise<void>;
};

export const HostServicesContext = createContext<HostServices | undefined>(
	undefined,
);

export const useHostServices = (): HostServices | undefined =>
	useContext(HostServicesContext);

export type HostServicesAccessor = Accessor<HostServices | undefined>;
