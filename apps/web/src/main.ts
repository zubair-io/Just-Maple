import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { SwUpdateService } from './app/services/sw-update.service';

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    appRef.injector.get(SwUpdateService);
  })
  .catch((err) => console.error(err));
