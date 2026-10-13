<?php
/**
 * Plugin Name: DIG Nexus Portal
 * Description: Accessible member portal linking to secure Google OIDC sign-in.
 * Version: 0.3.0
 */
if (!defined('ABSPATH')) { exit; }
add_shortcode('dig_nexus_portal', function () {
 $api = esc_url_raw(get_option('dig_nexus_api_url', ''));
 $html = '<section aria-labelledby="dig-nexus-title" class="dig-nexus-portal"><h2 id="dig-nexus-title">'
   . esc_html__('DIG Member Portal', 'dig-nexus') . '</h2>';
 if (!$api || !str_starts_with($api, 'https://')) {
  return $html . '<p role="status">' . esc_html__('Membership sign-in is not configured yet.', 'dig-nexus') . '</p></section>';
 }
 $url = esc_url(rtrim($api, '/') . '/auth/google/start');
 return $html . '<p>' . esc_html__('Sign in with Google to access the secure DIG portal. Signing in does not grant membership.', 'dig-nexus') . '</p><p><a href="' . $url . '">' . esc_html__('Continue with Google', 'dig-nexus') . '</a></p><p>' . esc_html__('Membership registration is not yet open.', 'dig-nexus') . '</p></section>';
});
