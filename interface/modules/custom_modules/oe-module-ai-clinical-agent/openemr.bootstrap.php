<?php

/**
 * AI Clinical Query Agent Module Bootstrap
 *
 * Registers the AgentForge clinical query agent as an OpenEMR custom module.
 * Injects a floating chat button into the OpenEMR UI that opens an iframe
 * to the deployed agent backend.
 *
 * @package   OpenEMR
 * @link      https://github.com/openemr/openemr
 * @author    AgentForge / Gauntlet AI
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

use OpenEMR\Core\ModulesClassLoader;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\AiClinicalAgent\Bootstrap;

$file = OEGlobalsBag::getInstance()->get('fileroot');
$classLoader = new ModulesClassLoader($file);
$classLoader->registerNamespaceIfNotExists('OpenEMR\\Modules\\AiClinicalAgent\\', __DIR__ . DIRECTORY_SEPARATOR . 'src');

$eventDispatcher = OEGlobalsBag::getInstance()->get('kernel')->getEventDispatcher();
$bootstrap = new Bootstrap($eventDispatcher);
$bootstrap->subscribeToEvents();
