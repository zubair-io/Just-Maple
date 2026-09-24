import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MuiButtonComponent, MuiInputComponent } from "@maple/ui";
import { NativeBridge } from "../core/native-bridge.service";
import { ConnectionsComponent } from "./connections.component";
@Component({
  selector: "maple-onboarding",
  standalone: true,
  imports: [MuiButtonComponent, MuiInputComponent, ConnectionsComponent],
  templateUrl: "./onboarding.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  readonly bridge = inject(NativeBridge);
  readonly s = this.bridge.state;
  name = this.s().name;
  step(value: number) {
    void this.bridge.act({ action: "step", value });
  }
  async introduce() {
    if (
      this.name.trim() &&
      (await this.bridge.act({ action: "introduce", name: this.name }))
    )
      this.step(2);
  }
}
