import { ApplicationRef, createComponent, EnvironmentInjector } from '@angular/core';
import { SlashCommandMenuComponent } from '../../molecules/slash-command-menu/slash-command-menu.component';
import {
  SuggestionMenuComponent,
  type SuggestionItem,
} from '../../molecules/suggestion-menu/suggestion-menu.component';
import type { SlashCommandItem } from './extensions';

/**
 * Positions a popup element below the cursor/selection rect.
 */
export function updatePopupPosition(
  popup: HTMLElement,
  clientRect: (() => DOMRect | null) | null,
): void {
  if (!clientRect) return;
  const rect = typeof clientRect === 'function' ? clientRect() : clientRect;
  if (!rect) return;
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 8}px`;
}

/**
 * Creates a TipTap suggestion renderer for the slash command menu.
 */
export function createSlashMenuRenderer(appRef: ApplicationRef, injector: EnvironmentInjector) {
  let popup: HTMLElement | null = null;
  let menuComponent: SlashCommandMenuComponent | null = null;
  let componentRef: any = null;
  let currentProps: any = null;

  return {
    onStart: (props: any) => {
      currentProps = props;

      popup = document.createElement('div');
      popup.classList.add('slash-menu-popup');
      popup.style.position = 'absolute';
      popup.style.zIndex = '1000';
      document.body.appendChild(popup);

      componentRef = createComponent(SlashCommandMenuComponent, {
        environmentInjector: injector,
        hostElement: popup,
      });

      menuComponent = componentRef.instance;
      menuComponent!.items.set(props.items);
      menuComponent!.query.set(props.query);

      componentRef.instance.commandSelected.subscribe((item: SlashCommandItem) => {
        if (currentProps) {
          currentProps.command(item);
        }
      });

      appRef.attachView(componentRef.hostView);
      updatePopupPosition(popup, props.clientRect);
    },

    onUpdate: (props: any) => {
      currentProps = props;
      if (menuComponent) {
        menuComponent.items.set(props.items);
        menuComponent.query.set(props.query);
      }
      if (popup && props.clientRect) {
        updatePopupPosition(popup, props.clientRect);
      }
    },

    onKeyDown: (props: any) => {
      if (!menuComponent) return false;
      if (props.event.key === 'ArrowUp') {
        menuComponent.navigateUp();
        return true;
      }
      if (props.event.key === 'ArrowDown') {
        menuComponent.navigateDown();
        return true;
      }
      if (props.event.key === 'Enter') {
        menuComponent.selectCurrent();
        return true;
      }
      return false;
    },

    onExit: () => {
      if (componentRef) {
        appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      }
      if (popup) {
        popup.remove();
        popup = null;
      }
      menuComponent = null;
    },
  };
}

/**
 * Creates a generic TipTap suggestion renderer that converts items to SuggestionItems.
 * Used for both page link suggestions and hashtag suggestions.
 */
export function createSuggestionRenderer<T>(
  appRef: ApplicationRef,
  injector: EnvironmentInjector,
  convertToItems: (items: T[]) => SuggestionItem[],
) {
  let popup: HTMLElement | null = null;
  let menuComponent: SuggestionMenuComponent | null = null;
  let componentRef: any = null;
  let currentProps: any = null;

  const createPopup = () => {
    popup = document.createElement('div');
    popup.classList.add('suggestion-menu-popup');
    popup.style.position = 'absolute';
    popup.style.zIndex = '1000';
    document.body.appendChild(popup);

    componentRef = createComponent(SuggestionMenuComponent, {
      environmentInjector: injector,
      hostElement: popup,
    });

    menuComponent = componentRef.instance;

    componentRef.instance.itemSelected.subscribe((item: SuggestionItem) => {
      if (currentProps) {
        const items = convertToItems(currentProps.items);
        const idx = items.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
          currentProps.command(currentProps.items[idx]);
        }
      }
    });

    appRef.attachView(componentRef.hostView);
  };

  const destroyPopup = () => {
    if (componentRef) {
      appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      componentRef = null;
    }
    if (popup) {
      popup.remove();
      popup = null;
    }
    menuComponent = null;
  };

  return {
    onStart: (props: any) => {
      currentProps = props;
      if (!props.items || props.items.length === 0) return;

      createPopup();
      menuComponent!.items.set(convertToItems(props.items));
      menuComponent!.query.set(props.query);
      updatePopupPosition(popup!, props.clientRect);
    },

    onUpdate: (props: any) => {
      currentProps = props;

      if (!props.items || props.items.length === 0) {
        destroyPopup();
        return;
      }

      if (!popup) {
        createPopup();
      }

      if (menuComponent) {
        menuComponent.items.set(convertToItems(props.items));
        menuComponent.query.set(props.query);
      }
      if (popup && props.clientRect) {
        updatePopupPosition(popup, props.clientRect);
      }
    },

    onKeyDown: (props: any) => {
      if (!menuComponent) return false;
      if (props.event.key === 'ArrowUp') {
        menuComponent.navigateUp();
        return true;
      }
      if (props.event.key === 'ArrowDown') {
        menuComponent.navigateDown();
        return true;
      }
      if (props.event.key === 'Enter') {
        menuComponent.selectCurrent();
        return true;
      }
      return false;
    },

    onExit: () => {
      destroyPopup();
    },
  };
}
