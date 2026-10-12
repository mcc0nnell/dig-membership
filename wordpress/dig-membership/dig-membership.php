<?php
/**
 * Plugin Name: DIG Membership
 * Plugin URI: https://deafingov.org/
 * Description: Accessible DIG enrollment and passwordless verification using Salesforce through a Cloudflare gateway.
 * Version: 0.2.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Author: Deaf in Government
 * License: Apache-2.0
 * Text Domain: dig-membership
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class DIG_Membership_Plugin {
    private const OPT_GATEWAY = 'dig_membership_gateway_url';
    private const OPT_SITE_KEY = 'dig_membership_turnstile_site_key';
    private const VER = '0.2.0';

    public static function boot() {
        add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
        add_action( 'admin_menu', array( __CLASS__, 'add_settings_page' ) );
        add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
        add_shortcode( 'dig_membership_join', array( __CLASS__, 'render_join' ) );
        add_shortcode( 'dig_membership_verify', array( __CLASS__, 'render_verify' ) );
        add_filter( 'wp_robots', array( __CLASS__, 'noindex_verify' ) );
    }

    public static function gateway() {
        $value = defined( 'DIG_MEMBERSHIP_GATEWAY_URL' )
            ? DIG_MEMBERSHIP_GATEWAY_URL : get_option( self::OPT_GATEWAY, '' );
        return is_string( $value ) ? self::sanitize_gateway( $value ) : '';
    }

    public static function site_key() {
        $value = defined( 'DIG_MEMBERSHIP_TURNSTILE_SITE_KEY' )
            ? DIG_MEMBERSHIP_TURNSTILE_SITE_KEY : get_option( self::OPT_SITE_KEY, '' );
        return is_string( $value ) && preg_match( '/^[A-Za-z0-9_-]{3,150}$/', $value ) ? $value : '';
    }

    public static function sanitize_gateway( $value ) {
        if ( ! is_string( $value ) || ! $value ) {
            return '';
        }
        $value = trim( $value );
        $parts = wp_parse_url( $value );
        if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) ||
             strtolower( $parts['scheme'] ) !== 'https' ||
             isset( $parts['user'] ) || isset( $parts['pass'] ) ||
             isset( $parts['query'] ) || isset( $parts['fragment'] ) ||
             ( isset( $parts['path'] ) && $parts['path'] !== '/' ) ||
             ! preg_match( '/^[a-z0-9.-]+$/i', $parts['host'] ) ) {
            add_settings_error( self::OPT_GATEWAY, 'dig_invalid_gateway', 'Use a HTTPS gateway origin without paths or parameters.' );
            return '';
        }
        return rtrim( $value, '/' );
    }

    public static function sanitize_site_key( $value ) {
        $value = is_string( $value ) ? trim( $value ) : '';
        return preg_match( '/^[A-Za-z0-9_-]{3,150}$/', $value ) ? $value : '';
    }

    public static function register_settings() {
        register_setting( 'dig_membership_settings', self::OPT_GATEWAY, array(
            'type' => 'string', 'sanitize_callback' => array( __CLASS__, 'sanitize_gateway' ), 'default' => '',
        ) );
        register_setting( 'dig_membership_settings', self::OPT_SITE_KEY, array(
            'type' => 'string', 'sanitize_callback' => array( __CLASS__, 'sanitize_site_key' ), 'default' => '',
        ) );
    }

    public static function add_settings_page() {
        add_options_page( 'DIG Membership', 'DIG Membership', 'manage_options', 'dig-membership', array( __CLASS__, 'settings_page' ) );
    }

    public static function settings_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>DIG Membership</h1>
            <p>Salesforce remains the member system of record. The Cloudflare gateway protects all Salesforce credentials.</p>
            <?php settings_errors(); ?>
            <form action="options.php" method="post">
                <?php settings_fields( 'dig_membership_settings' ); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="dig_gateway">Gateway HTTPS origin</label></th>
                        <td><input id="dig_gateway" class="regular-text" type="url" name="<?php echo esc_attr( self::OPT_GATEWAY ); ?>" value="<?php echo esc_attr( get_option( self::OPT_GATEWAY, '' ) ); ?>" placeholder="https://membership-api.example.org" <?php disabled( defined( 'DIG_MEMBERSHIP_GATEWAY_URL' ) ); ?> />
                        <p class="description">Set the exact Cloudflare Worker origin; no path or trailing slash. Can be set by DIG_MEMBERSHIP_GATEWAY_URL in wp-config.php.</p></td></tr>
                    <tr><th scope="row"><label for="dig_turnstile">Turnstile public site key</label></th>
                        <td><input id="dig_turnstile" class="regular-text" type="text" name="<?php echo esc_attr( self::OPT_SITE_KEY ); ?>" value="<?php echo esc_attr( get_option( self::OPT_SITE_KEY, '' ) ); ?>" <?php disabled( defined( 'DIG_MEMBERSHIP_TURNSTILE_SITE_KEY' ) ); ?> />
                        <p class="description">Only the public site key goes here; store the matching secret on Cloudflare. Register the WordPress hostname with Turnstile.</p></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
            <h2>Pages</h2>
            <p>Create a WordPress page at <code>/membership</code> containing <code>[dig_membership_join]</code> and a page at <code>/magic</code> containing <code>[dig_membership_verify]</code>. Disable caching and analytics on <code>/magic</code>.</p>
        </div>
        <?php
    }

    public static function register_assets() {
        $base = plugin_dir_url( __FILE__ );
        wp_register_style( 'dig-membership', $base . 'assets/dig-membership.css', array(), self::VER );
        wp_register_script( 'dig-membership', $base . 'assets/dig-membership.js', array(), self::VER, true );
        // Themes print styles in wp_head, so enqueue early for ordinary WP pages.
        // Shortcode rendering still enqueues as a fallback for page builders.
        if ( is_singular() ) {
            $content = get_post_field( 'post_content', get_queried_object_id() );
            if ( is_string( $content ) && (
                has_shortcode( $content, 'dig_membership_join' ) ||
                has_shortcode( $content, 'dig_membership_verify' )
            ) ) {
                wp_enqueue_style( 'dig-membership' );
            }
        }
    }

    private static function assets( $mode ) {
        wp_enqueue_style( 'dig-membership' );
        wp_enqueue_script( 'dig-membership' );
        wp_add_inline_script( 'dig-membership', 'window.DIGMembership = ' . wp_json_encode( array(
            'gateway' => self::gateway(),
            'siteKey' => self::site_key(),
        ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';', 'before' );
        if ( $mode === 'join' ) {
            wp_enqueue_script( 'dig-turnstile', 'https://challenges.cloudflare.com/turnstile/v0/api.js', array(), null, true );
        }
    }

    private static function ready() {
        return self::gateway() !== '' && self::site_key() !== '';
    }

    public static function render_join() {
        self::assets( 'join' );
        if ( ! self::ready() ) {
            return '<p class="dig-membership">DIG membership enrollment is temporarily unavailable. Please check back later.</p>';
        }
        ob_start(); ?>
        <section class="dig-membership" data-dig-mode="join" aria-labelledby="dig-join-title">
            <h2 id="dig-join-title">Join Deaf in Government</h2>
            <p>Connect with Deaf and hard-of-hearing government professionals and allies. Verify your email to join.</p>
            <form class="dig-membership__form" novalidate>
                <div><label for="dig-first-name">First name</label><input id="dig-first-name" name="firstName" type="text" autocomplete="given-name" maxlength="40" /></div>
                <div><label for="dig-last-name">Last name <span aria-hidden="true">*</span></label><input id="dig-last-name" name="lastName" type="text" autocomplete="family-name" maxlength="80" required /></div>
                <div><label for="dig-email">Email address <span aria-hidden="true">*</span></label><input id="dig-email" name="email" type="email" autocomplete="email" maxlength="80" required /></div>
                <div class="dig-membership__honeypot" aria-hidden="true"><label for="dig-website">Leave this blank</label><input id="dig-website" name="website" tabindex="-1" autocomplete="off" /></div>
                <div class="cf-turnstile" data-sitekey="<?php echo esc_attr( self::site_key() ); ?>"></div>
                <button type="submit" class="dig-membership__submit">Email my verification link</button>
            </form>
            <p role="status" aria-live="polite" aria-atomic="true" class="dig-membership__status" data-dig-status></p>
            <p class="dig-membership__hint">No password is required. Existing current membership terms are preserved. No payment information is collected by this form.</p>
        </section>
        <?php return ob_get_clean();
    }

    public static function render_verify() {
        self::assets( 'verify' );
        if ( ! self::ready() ) {
            return '<p class="dig-membership">DIG membership verification is temporarily unavailable. Please try again later.</p>';
        }
        ob_start(); ?>
        <section class="dig-membership" data-dig-mode="verify" aria-labelledby="dig-verify-title">
            <h2 id="dig-verify-title">Confirm your DIG membership</h2>
            <p>We are verifying your one-time link. A link can be used only once.</p>
            <p role="status" aria-live="polite" aria-atomic="true" class="dig-membership__status" data-dig-status>Checking your link…</p>
            <p><a href="<?php echo esc_url( home_url( '/membership' ) ); ?>">Request a new verification link</a></p>
        </section>
        <?php return ob_get_clean();
    }

    public static function noindex_verify( $robots ) {
        if ( is_page( 'magic' ) ) {
            $robots['noindex'] = true;
            $robots['nofollow'] = true;
        }
        return $robots;
    }
}
DIG_Membership_Plugin::boot();
