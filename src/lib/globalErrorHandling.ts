import i18n from '../i18n/config';
import { useToastStore } from '../stores/toastStore';
import { PermissionDeniedError } from './mutationGuard';

// Safety net for every mutation call site that has no .catch() of its own —
// most of them (EmployeeGrid's delete/inline-edit, the chart's context-menu
// actions, AssignmentEditorModal, AccountMenu's approve/refuse...). A denied
// UPDATE/DELETE now throws PermissionDeniedError (mutationGuard.ts) instead
// of silently succeeding, but a thrown error in a fire-and-forget
// `onClick={() => doThing()}` handler is still just an unhandled rejection —
// this is what turns that into a visible toast instead of console noise
// nobody sees. Call sites that already have their own .catch() (e.g.
// ClientsMissionsGrid, OrgChartManagerModal's delete flow) handle the error
// themselves and never reach here, since it's no longer "unhandled".
export function installGlobalErrorHandling() {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof PermissionDeniedError) {
      event.preventDefault();
      useToastStore.getState().show({ message: i18n.t('errors.permissionDenied') });
    }
  });
}
