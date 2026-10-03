#!/usr/bin/env python3
"""Real Chromium UI regression suite. All intercepted operations feeds are MOCKS.

Run: python tests/browser_smoke.py
Optional real local bridge: python tests/browser_smoke.py --base-url http://127.0.0.1:8787
Requires Python Playwright and Chromium (CHROMIUM_PATH or /usr/bin/chromium).
The default server is static and never probes real services. Test browsers use
isolated temporary profiles, so personal saves and real systems are untouched.
"""
from __future__ import annotations
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
import unittest
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / 'docs' / 'screenshots'
KEY = 'eog.connected.practice.v1'
BUSINESSES = ['web', 'drywall', 'kdp', 'affiliate', 'apparel', 'corporate', 'property', 'housing', 'fitness']
BASE_URL = ''
REAL_BRIDGE = False

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
        else:
            super().do_GET()


def mock_feed(**changes):
    """Fixture only: this is NOT observed business or service evidence."""
    value = dict(schema_version=1, read_only=True, mode='connected',
                 generated_at=datetime.now(timezone.utc).isoformat(),
                 sources=[dict(id='local-registry', status='ok')],
                 projects=[dict(id='client-services', name='MOCK Web Agency',
                                evidence='MOCK registry observation; no service was contacted', prerequisites=[])])
    value.update(changes)
    return value


class BrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport=dict(width=1440, height=1100), device_scale_factor=1, accept_downloads=True)
        self.page = self.context.new_page()
        self.page_errors = []
        self.console_errors = []
        self.allowed_network_errors = False
        self.attach_errors(self.page)
        self.page.goto(BASE_URL + '/empire.html', wait_until='networkidle')
        expect(self.page.locator('#mission-count')).to_have_text('0')

    def attach_errors(self, page):
        page.on('pageerror', lambda error: self.page_errors.append(str(error)))
        page.on('console', lambda message: self.console_errors.append(message.text) if message.type == 'error' else None)

    def tearDown(self):
        try:
            self.assertEqual(self.page_errors, [], 'Unexpected JavaScript exceptions')
            if not self.allowed_network_errors:
                self.assertEqual(self.console_errors, [], 'Unexpected console errors')
            else:
                # The unavailable endpoint test deliberately creates an HTTP error.
                unexpected = [x for x in self.console_errors if 'Failed to load resource' not in x]
                self.assertEqual(unexpected, [], 'Unexpected non-network console errors')
        finally:
            self.context.close()

    def choose(self, business, page=None):
        (page or self.page).locator(f'[data-business="{business}"]').click()

    def mission(self, identifier, strategy='focused'):
        return self.page.locator(f'button[data-mission="{identifier}"][data-strategy="{strategy}"]')

    def counts(self, completed, credits, focus, xp):
        expect(self.page.locator('#mission-count')).to_have_text(str(completed))
        expect(self.page.locator('#credits-value')).to_have_text(str(credits))
        expect(self.page.locator('#focus-value')).to_have_text(f'{focus} / 6')
        expect(self.page.locator('#xp-count')).to_have_text(f'{xp} XP')

    def saved(self, page=None):
        return (page or self.page).evaluate('(key) => localStorage.getItem(key)', KEY)

    def import_content(self, content, name='test-save.json'):
        self.page.locator('#import-save').set_input_files(dict(name=name, mimeType='application/json', buffer=content.encode()))

    def mock_response(self, value, *, content_type='application/json', status=200):
        body = value if isinstance(value, str) else json.dumps(value)
        self.page.unroute('**/api/empire-state')
        self.page.route('**/api/empire-state', lambda route: route.fulfill(status=status, content_type=content_type, body=body))

    def refresh(self):
        self.page.locator('#operations-tab').click()
        self.page.locator('#refresh-feed').click()
        expect(self.page.locator('#refresh-feed')).to_be_enabled()

    def assert_no_overflow(self, page=None):
        result = (page or self.page).evaluate('({client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})')
        self.assertLessEqual(result['scroll'], result['client'], result)

    def test_01_desktop_mobile_rendering_and_screenshots(self):
        expect(self.page.locator('.business-card')).to_have_count(9)
        self.assert_no_overflow()
        self.page.screenshot(path=str(SCREENSHOTS / 'campaign-desktop.png'), full_page=True)
        mobile = self.browser.new_context(viewport=dict(width=390, height=844), device_scale_factor=1, is_mobile=True, has_touch=True)
        try:
            page = mobile.new_page()
            self.attach_errors(page)
            page.goto(BASE_URL + '/empire.html', wait_until='networkidle')
            self.assert_no_overflow(page)
            page.screenshot(path=str(SCREENSHOTS / 'campaign-mobile.png'), full_page=True)
            page.locator('[data-business="web"]').click()
            page.locator('button[data-mission="web:plan"]').click()
            expect(page.locator('#mission-count')).to_have_text('1')
            self.assert_no_overflow(page)
            page.locator('#operations-tab').click()
            expect(page.locator('#operations-view')).to_be_visible()
            self.assert_no_overflow(page)
        finally:
            mobile.close()
        # Additional small and tablet breakpoints, including narrow phone width.
        for width in [320, 470, 768, 1024]:
            self.page.set_viewport_size(dict(width=width, height=900))
            self.assert_no_overflow()

    def test_02_cross_business_locks_rewards_and_reload(self):
        expect(self.page.locator('#next-day')).to_be_disabled()
        self.choose('drywall')
        expect(self.mission('drywall:plan')).to_have_count(0)
        expect(self.page.locator('#mission-panel')).to_contain_text('Web Studio · blueprint')
        self.choose('web')
        # Repeat the same DOM action even after its control has been replaced.
        self.mission('web:plan').evaluate('(button) => { button.click(); button.click(); }')
        self.counts(1, 110, 5, 20)
        expect(self.page.locator('#announcement')).to_contain_text('Already completed')
        self.assertEqual(len(json.loads(self.saved())['events']), 1)
        self.choose('drywall')
        expect(self.mission('drywall:plan')).to_be_enabled()
        expect(self.mission('drywall:trial')).to_have_count(0)
        self.choose('web')
        self.mission('web:trial', 'crafted').click()
        self.counts(2, 155, 2, 80)
        self.choose('drywall')
        self.mission('drywall:plan').click()
        self.counts(3, 145, 1, 100)
        expect(self.mission('drywall:trial')).to_be_disabled()
        expect(self.mission('drywall:trial', 'crafted')).to_be_disabled()
        self.page.locator('#next-day').click()
        self.counts(3, 145, 6, 100)
        self.mission('drywall:trial').click()
        self.counts(4, 175, 4, 140)
        saved = self.saved()
        self.page.reload(wait_until='networkidle')
        self.counts(4, 175, 4, 140)
        self.assertEqual(self.saved(), saved)
        expect(self.page.locator('#rank')).to_have_text('OPERATOR')

    def test_03_all_eighteen_missions_complete_once(self):
        for business in BUSINESSES:
            self.choose(business)
            for stage in ['plan', 'trial']:
                button = self.mission(business + ':' + stage)
                if not button.is_enabled():
                    self.page.locator('#next-day').click()
                button.click()
        self.counts(18, 300, 3, 540)
        expect(self.page.locator('#day-value')).to_have_text('05')
        expect(self.page.locator('#loop-count')).to_have_text('9 / 9 delivery loops')
        expect(self.page.locator('#rank')).to_have_text('EMPIRE BUILDER')
        expect(self.page.locator('#next-day')).to_be_disabled()
        self.assertEqual(self.page.locator('.business-state.complete').count(), 9)
        self.page.reload(wait_until='networkidle')
        self.counts(18, 300, 3, 540)

    def test_04_export_import_invalid_saves_reset_cancel_confirm(self):
        self.mission('web:plan').click()
        self.mission('web:trial').click()
        original = self.saved()
        with self.page.expect_download() as event:
            self.page.locator('#export-save').click()
        download = event.value
        self.assertEqual(download.suggested_filename, 'empire-practice-save.json')
        exported = Path(download.path()).read_text()
        self.assertEqual(json.loads(exported), json.loads(original))
        self.page.locator('#reset-save').click()
        expect(self.page.locator('#reset-dialog')).to_be_visible()
        self.page.locator('#cancel-reset').click()
        expect(self.page.locator('#reset-dialog')).not_to_be_visible()
        self.counts(2, 140, 3, 60)
        self.assertEqual(self.saved(), original)
        self.page.locator('#reset-save').click()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#reset-dialog')).not_to_be_visible()
        self.assertEqual(self.saved(), original)
        self.page.locator('#reset-save').click()
        self.page.locator('#confirm-reset').click()
        self.counts(0, 120, 6, 0)
        self.import_content(exported)
        expect(self.page.locator('#announcement')).to_contain_text('Practice save imported')
        self.counts(2, 140, 3, 60)
        cases = ['{', 'null', '[]', 'x' * 50001,
                 json.dumps(dict(version=2, mode='simulation', events=[])),
                 json.dumps(dict(version=1, mode='real', events=[])),
                 json.dumps(dict(version=1, mode='simulation', events=[dict(type='mission', id='unknown')])),
                 json.dumps(dict(version=1, mode='simulation', events=[dict(type='mission', id='web:plan')] * 2))]
        for bad in cases:
            self.import_content(bad)
            expect(self.page.locator('#announcement')).to_contain_text('Save was not imported')
            self.counts(2, 140, 3, 60)
            self.assertEqual(self.saved(), original)
        forged = json.loads(exported)
        forged.update(credits=999999, xp=999999, completed=['anything'])
        self.import_content(json.dumps(forged))
        expect(self.page.locator('#announcement')).to_contain_text('Practice save imported')
        self.counts(2, 140, 3, 60)

    def test_05_navigation_back_forward(self):
        self.page.locator('#operations-tab').click()
        expect(self.page).to_have_url(BASE_URL + '/empire.html#operations')
        expect(self.page.locator('#operations-view')).to_be_visible()
        expect(self.page.locator('#practice-view')).not_to_be_visible()
        expect(self.page.locator('#campaign-score')).not_to_be_visible()
        self.page.locator('#practice-tab').click()
        expect(self.page).to_have_url(BASE_URL + '/empire.html#practice')
        self.page.go_back()
        expect(self.page.locator('#operations-view')).to_be_visible()
        expect(self.page.locator('#operations-tab')).to_have_attribute('aria-pressed', 'true')
        self.page.go_back()
        expect(self.page.locator('#practice-view')).to_be_visible()
        self.page.go_forward()
        expect(self.page.locator('#operations-view')).to_be_visible()
        self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#operations-view')).to_be_visible()

    def test_06_two_tabs_share_state_and_prevent_repeat_rewards(self):
        tab = self.context.new_page()
        self.attach_errors(tab)
        tab.goto(BASE_URL + '/empire.html', wait_until='networkidle')
        self.mission('web:plan').click()
        expect(tab.locator('#mission-count')).to_have_text('1')
        expect(tab.locator('button[data-mission="web:plan"]')).to_have_count(0)
        tab.locator('button[data-mission="web:trial"][data-strategy="focused"]').click()
        self.counts(2, 140, 3, 60)
        self.assertEqual(self.saved(tab), self.saved())
        self.assertEqual(len(json.loads(self.saved())['events']), 2)
        tab.close()

    def test_07_mock_feed_display_xss_and_planning_brief(self):
        injection = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
        candidate = mock_feed()
        candidate['projects'][0]['evidence'] = injection
        candidate['revenue'] = 999999
        candidate['projects'][0]['command'] = 'execute-real-job'
        self.mock_response(candidate)
        self.refresh()
        expect(self.page.locator('#feed-status')).to_have_text('Read-only · observed')
        expect(self.page.locator('#operation-businesses')).to_contain_text(injection)
        self.assertEqual(self.page.locator('#source-list img, #source-list script, #operation-businesses img, #operation-businesses script').count(), 0)
        self.assertIsNone(self.page.evaluate('window.__xss'))
        expect(self.page.locator('#operations-view')).not_to_contain_text('999999')
        expect(self.page.locator('.feed-summary')).to_contain_text('Not connected')
        expect(self.page.locator('.feed-summary')).to_contain_text('Disabled')
        self.assertEqual(self.page.locator('.operation-row').count(), 9)
        with self.page.expect_download() as event:
            self.page.locator('[data-brief="web"]').click()
        brief = Path(event.value.path()).read_text()
        self.assertIn('not a completed task or an authorization', brief)
        self.assertIn('Practice campaign progress is deliberately excluded.', brief)
        self.assertIn('Business activity and revenue: unverified.', brief)
        self.assertIn(injection, brief)

    def test_08_mock_feed_rejection_retains_stale_snapshot(self):
        self.mock_response(mock_feed())
        self.refresh()
        expect(self.page.locator('#feed-status')).to_have_text('Read-only · observed')
        malformed = [
            ('{', 'application/json', 'JSON'),
            (dict(mock_feed(), read_only=False), 'application/json', 'read-only'),
            (dict(mock_feed(), schema_version=99), 'application/json', 'contract'),
            (dict(mock_feed(), projects=[dict(id='client-services', name='x' * 181, evidence='bad', prerequisites=[])]), 'application/json', 'project'),
            (dict(mock_feed(), sources=[dict(id='bad', status='business-verified')]), 'application/json', 'source'),
            ('x' * 1048577, 'application/json', 'safe size limit'),
            ('<html>Wrong endpoint</html>', 'text/html', 'did not return JSON'),
        ]
        for value, content_type, error_hint in malformed:
            self.mock_response(value, content_type=content_type)
            self.refresh()
            expect(self.page.locator('#feed-status')).to_have_text('Stale snapshot')
            expect(self.page.locator('#feed-explanation')).to_contain_text(error_hint, ignore_case=True)
            expect(self.page.locator('#source-list')).to_contain_text('stale · last: ok')
            self.assert_no_overflow()
        self.page.locator('#practice-tab').click()
        self.mission('web:plan').click()
        self.counts(1, 110, 5, 20)

    def test_09_mock_feed_unavailable_offline_and_staleness(self):
        self.allowed_network_errors = True
        self.mock_response('{}', status=503)
        self.refresh()
        expect(self.page.locator('#feed-status')).to_have_text('Unavailable')
        expect(self.page.locator('#feed-explanation')).to_contain_text('HTTP 503')
        self.mock_response(mock_feed(mode='offline', sources=[dict(id='local-registry', status='offline')], projects=[]))
        self.refresh()
        expect(self.page.locator('#feed-status')).to_have_text('Offline bridge')
        expect(self.page.locator('#feed-explanation')).to_contain_text('No local services were probed')
        for age in [timedelta(minutes=-10), timedelta(minutes=10)]:
            self.mock_response(mock_feed(generated_at=(datetime.now(timezone.utc) + age).isoformat()))
            self.refresh()
            expect(self.page.locator('#feed-status')).to_have_text('Stale snapshot')

    def test_10_actual_offline_bridge_or_static_unavailable(self):
        if REAL_BRIDGE:
            self.refresh()
            expect(self.page.locator('#feed-status')).to_have_text('Offline bridge')
            expect(self.page.locator('#feed-explanation')).to_contain_text('No local services were probed')
            self.assertEqual(self.page.locator('.operation-row').count(), 9)
            self.page.screenshot(path=str(SCREENSHOTS / 'operations-offline-desktop.png'), full_page=True)
        else:
            self.allowed_network_errors = True
            self.refresh()
            expect(self.page.locator('#feed-status')).to_have_text('Unavailable')
            expect(self.page.locator('#feed-explanation')).to_contain_text('HTTP 404')


    def test_11_write_only_storage_failure_preserves_unsaved_work(self):
        # Preserve a valid older save, then make writes fail while reads still work.
        self.mission('web:plan').click()
        older_save = self.saved()
        self.page.evaluate("Storage.prototype.setItem = function () { throw new DOMException('Test-only storage failure', 'QuotaExceededError'); };")
        self.mission('web:trial').click()
        self.counts(2, 140, 3, 60)
        expect(self.page.locator('#announcement')).to_contain_text('Session only')
        expect(self.page.locator('#announcement')).not_to_contain_text('saved locally')
        expect(self.page.locator('#save-status')).to_have_text('Session only · export to keep')
        self.assertEqual(self.saved(), older_save)
        self.page.locator('#next-day').click()
        self.counts(2, 140, 6, 60)
        expect(self.page.locator('#day-value')).to_have_text('02')
        expect(self.page.locator('#announcement')).to_contain_text('Session only')
        self.assertEqual(self.saved(), older_save)
        with self.page.expect_download() as event:
            self.page.locator('#export-save').click()
        exported = json.loads(Path(event.value.path()).read_text())
        self.assertEqual(len(exported['events']), 3)
        # Import and reset are still usable; neither may claim persistence.
        self.import_content(older_save)
        self.counts(1, 110, 5, 20)
        expect(self.page.locator('#announcement')).to_contain_text('Session only')
        self.assertEqual(self.saved(), older_save)
        self.page.locator('#reset-save').click()
        self.page.locator('#confirm-reset').click()
        self.counts(0, 120, 6, 0)
        expect(self.page.locator('#announcement')).to_contain_text('Session only')
        self.assertEqual(self.saved(), older_save)
        self.mission('web:plan').click()
        self.counts(1, 110, 5, 20)
        expect(self.page.locator('#announcement')).to_contain_text('Session only')

    def test_12_mock_long_valid_evidence_does_not_break_mobile_layout(self):
        candidate = mock_feed()
        candidate['projects'][0]['evidence'] = 'W' * 180
        self.mock_response(candidate)
        self.refresh()
        expect(self.page.locator('#feed-status')).to_have_text('Read-only · observed')
        for width in [1440, 768, 390, 320]:
            self.page.set_viewport_size(dict(width=width, height=900))
            self.assert_no_overflow()


def main():
    global BASE_URL, REAL_BRIDGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', help='Existing offline bridge origin, e.g. http://127.0.0.1:8787')
    args, unittest_args = parser.parse_known_args()
    server = None
    if args.base_url:
        BASE_URL = args.base_url.rstrip('/')
        REAL_BRIDGE = True
    else:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        BASE_URL = 'http://127.0.0.1:' + str(server.server_port)
    try:
        unittest.main(argv=['browser_smoke.py'] + unittest_args, verbosity=2)
    finally:
        if server:
            server.shutdown()
            server.server_close()

if __name__ == '__main__':
    main()
