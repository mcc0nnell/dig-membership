<?php
/**
 * Plugin Name: DIG Nexus Portal
 * Description: Accessible member portal shell. Authentication and enrollment remain gated.
 * Version: 0.2.0
 */
if (!defined('ABSPATH')) { exit; }
add_shortcode('dig_nexus_portal', function () {
 $api = esc_url_raw(get_option('dig_nexus_api_url', ''));
 $html = '<section aria-labelledby="dig-nexus-title" class="dig-nexus-portal"><h2 id="dig-nexus-title">'
   . esc_html__('DIG Member Portal', 'dig-nexus') . '</h2>';
 if (!$api || !str_starts_with($api, 'https://')) {
  return $html . '<p role="status">' . esc_html__('Membership sign-in is not configured yet.', 'dig-nexus') . '</p></section>';
 }
 return $html . '<p role="status">' . esc_html__('Secure sign-in is being configured. Registration is not yet open.', 'dig-nexus') . '</p></section>';
});
