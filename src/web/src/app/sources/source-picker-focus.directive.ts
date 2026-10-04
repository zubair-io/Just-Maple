import { Directive } from '@angular/core';
import { MuiDialogFocusDirective } from '@maple/ui';

@Directive({ selector: 'dialog[mapleSourcePicker]', standalone: true,
  hostDirectives: [{ directive: MuiDialogFocusDirective,
    inputs: ['dialogReturnFocus: pickerReturnFocus'], outputs: ['dialogClosed: pickerClosed'] }] })
export class SourcePickerFocusDirective {}
