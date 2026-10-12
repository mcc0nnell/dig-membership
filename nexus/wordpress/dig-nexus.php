<?php
/**
 * Plugin Name: DIG Nexus Portal
 * Description: Accessible prototype portal shell, no live membership operations.
 * Version: 0.1.0
 */
if (!defined('ABSPATH')) { exit; }
add_shortcode('dig_nexus_portal', function () {
 return '<section aria-labelledby="dig-nexus-title"><h2 id="dig-nexus-title">'
   . esc_html__('DIG Member Portal', 'dig-nexus')
   . '</h2><p>'
   . esc_html__('Membership registration is not yet available.', 'dig-nexus')
   . '</p></section>';
});
