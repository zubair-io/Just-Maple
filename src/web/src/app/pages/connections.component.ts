import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from "@angular/core";
import {
  MuiButtonComponent,
  MuiCheckboxComponent,
  MuiInputComponent,
} from "@maple/ui";
import { NativeBridge, SimpleAction } from "../core/native-bridge.service";
@Component({
  selector: "maple-connections",
  standalone: true,
  imports: [MuiButtonComponent, MuiCheckboxComponent, MuiInputComponent],
  templateUrl: "./connections.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsComponent {
  readonly bridge = inject(NativeBridge);
  readonly s = this.bridge.state;
  readonly scope = input<"all" | "calendar" | "intelligence">("all");
  key = "";
  url = "";
  token = "";
  appleSelection: string[] = [];
  googleSelection: string[] = [];
  homeSelection: string[] = [];
  appleDirty = false;
  googleDirty = false;
  homeDirty = false;
  constructor() {
    effect(() => {
      const s = this.s();
      if (!this.appleDirty) this.appleSelection = [...s.selectedCalendarIDs];
      if (!this.googleDirty)
        this.googleSelection = [...s.selectedGoogleCalendarIDs];
      if (!this.homeDirty) this.homeSelection = [...s.selectedHomeEntities];
      if (!this.url) this.url = s.homeURL;
    });
  }
  act(action: SimpleAction) {
    void this.bridge.act({ action });
  }
  toggle(kind: "apple" | "google" | "home", id: string, checked: boolean) {
    const key =
      kind === "apple"
        ? "appleSelection"
        : kind === "google"
          ? "googleSelection"
          : "homeSelection";
    this[key] = checked
      ? [...new Set([...this[key], id])]
      : this[key].filter((v) => v !== id);
    this[`${kind}Dirty`] = true;
  }
  choose(kind: "apple" | "google", all: boolean) {
    this[`${kind}Selection`] = all
      ? (kind === "apple"
          ? this.s().calendarChoices
          : this.s().googleCalendars
        ).map((c) => c.id)
      : [];
    this[`${kind}Dirty`] = true;
  }
  async save(kind: "apple" | "google" | "home") {
    if (
      await this.bridge.act({
        action:
          kind === "apple"
            ? "calendarSelection"
            : kind === "google"
              ? "googleCalendarSelection"
              : "homeSelection",
        ids: this[`${kind}Selection`],
      })
    )
      this[`${kind}Dirty`] = false;
  }
  async connectHome() {
    if (
      await this.bridge.act({
        action: "homeConnect",
        url: this.url,
        token: this.token,
      })
    )
      this.token = "";
  }
  async connectJev() {
    if (await this.bridge.act({ action: "connect", key: this.key }))
      this.key = "";
  }
  provider(action: "providerTest" | "providerSelect", provider:string) {
    void this.bridge.act({action,provider});
  }
  exposure(enabled: boolean) {
    void this.bridge.act({ action: "homeExposure", enabled });
  }
}
