/**
 * AgentForge Chat Panel Controller
 *
 * Manages the floating action button and iframe panel
 * for the AI Clinical Query Agent within OpenEMR.
 */
const AgentForge = {
  isOpen: false,

  toggle() {
    this.isOpen = !this.isOpen;
    const panel = document.getElementById('agentforge-panel');
    const fab = document.getElementById('agentforge-fab');
    if (panel && fab) {
      panel.style.display = this.isOpen ? 'flex' : 'none';
      fab.style.display = this.isOpen ? 'none' : 'flex';
    }
  },

  updatePatient(pid) {
    const iframe = document.getElementById('agentforge-iframe');
    if (iframe) {
      const url = new URL(iframe.src);
      url.searchParams.set('pid', pid);
      iframe.src = url.toString();
    }
  }
};

// Listen for patient context changes in OpenEMR
document.addEventListener('DOMContentLoaded', () => {
  // OpenEMR updates the pid in the URL when switching patients
  const observer = new MutationObserver(() => {
    const pidMatch = window.location.href.match(/[?&]pid=(\d+)/);
    if (pidMatch) {
      AgentForge.updatePatient(pidMatch[1]);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
