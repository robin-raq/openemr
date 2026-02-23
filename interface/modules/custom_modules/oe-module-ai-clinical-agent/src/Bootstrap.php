<?php

/**
 * AI Clinical Query Agent Bootstrap Class
 *
 * Subscribes to OpenEMR render events to inject the chat panel UI.
 *
 * @package   OpenEMR
 * @link      https://github.com/openemr/openemr
 * @author    AgentForge / Gauntlet AI
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

namespace OpenEMR\Modules\AiClinicalAgent;

use OpenEMR\Events\PatientDemographics\RenderEvent;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;
use OpenEMR\Core\OEGlobalsBag;

class Bootstrap
{
    const MODULE_INSTALLATION_PATH = "/interface/modules/custom_modules/oe-module-ai-clinical-agent";

    private string $installPath;

    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher
    ) {
        $this->installPath = OEGlobalsBag::getInstance()->get('web_root') . self::MODULE_INSTALLATION_PATH;
    }

    public function subscribeToEvents(): void
    {
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_POST, [$this, 'renderChatPanel']);
    }

    public function renderChatPanel(RenderEvent $event): void
    {
        $pid = $_SESSION['pid'] ?? '';
        $installPath = $this->installPath;

        // The agent URL — update this to your Railway deployment URL
        $agentUrl = getenv('AGENTFORGE_URL') ?: 'http://localhost:3000';

        $html = <<<HTML
        <link rel="stylesheet" href="{$installPath}/public/assets/css/chat-panel.css">
        <div id="agentforge-fab" onclick="AgentForge.toggle()" title="AI Clinical Query Agent">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
        </div>
        <div id="agentforge-panel" style="display:none;">
            <div id="agentforge-panel-header">
                <span>AgentForge - Clinical Query</span>
                <button onclick="AgentForge.toggle()" title="Close">&times;</button>
            </div>
            <iframe id="agentforge-iframe" src="{$agentUrl}?pid={$pid}" allow="clipboard-write"></iframe>
        </div>
        <script src="{$installPath}/public/assets/js/chat-panel.js"></script>
        HTML;

        $event->setOutput($event->getOutput() . $html);
    }
}
