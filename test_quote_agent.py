"""Financial, evidence, privacy and persistence checks; never sends mail."""
import copy
import json
import os
import tempfile
import threading
import time
import unittest
from decimal import Decimal
from email import policy
from email.parser import BytesParser
from unittest.mock import patch

import quote_agent as q

TEMP = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + TEMP.name.replace("\\", "/") + "/test.db"
os.environ["ADMIN_API_KEY"] = "quote-agent-test-key"
os.environ["MAILGUN_API_KEY"] = ""
import admin_api_flask as app


def sample():
    archive = q.Archive(lambda: None, (), lambda: [], lambda: [])
    archive.trace = [{"label": "search_history"}]
    archive.read_assets["pdf:old"] = {"filename": "old.pdf", "quote_date": "2025-01-01", "quote_number": "42",
        "tax_basis": "inclusive", "tax_rate_percent": 25, "verified_totals": True,
        "lines": [{"article_number": "A1", "description": "Exakt variant 2007", "quantity": 1,
                   "unit": "st", "unit_price_sek": 100.60, "discount_percent": 10, "sum_sek": 90.54}]}
    archive.read_sources["gmail:old"] = {"text": "Originalkapell för exakt variant 2007", "subject": "Offert"}
    raw = {"decision": "quote_draft", "explanation": "Källan matchar varianten.", "summary": "Offertutkast", "intent": "offert", "confidence": 1,
           "customer": {"name": "Kund", "email": "previous@example.test", "phone": "", "address": "", "postal_code": "", "city": ""},
           "boat": {"manufacturer": "Test", "model": "Variant", "year": "2007", "current_canopy": "original"},
           "missing_customer_fields": [], "internal_blockers": [],
           "facts": [{"claim": "Originalkapell", "source_id": "gmail:old", "excerpt": "Originalkapell för exakt variant 2007"}],
           "email": {"subject": "Offert", "body": "Hej\n\nSe bifogad offert!"},
           "quote_rows": [{"asset_id": "pdf:old", "row_index": 0}], "quote_notes": []}
    return raw, archive, {"fields": {"E-post": "current@example.test"}}


class EvidenceTests(unittest.TestCase):
    def test_research_and_review_receive_the_same_actual_customer_images(self):
        raw, archive, source = sample()
        source.update(id='image-request',input_images=[
            {'filename':'first.jpg','data_url':'data:image/jpeg;base64,first'},
            {'filename':'second.jpg','data_url':'data:image/jpeg;base64,second'}])
        raw['facts'].append({'claim':'Bildobservation', 'source_id':'image-request:image:2', 'excerpt':'En båt med kapell syns i bilden.'})
        responses = [
            {'status':'completed','output':[{'type':'function_call','name':'search_history','call_id':'c1','arguments':'{"query":"Test"}'}]},
            {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(raw)}]}]},
            {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"safe":true,"issues":[]}'}]}]}
        ]
        with patch.object(q.requests,'post') as api:
            from unittest.mock import Mock
            api.side_effect = [Mock(status_code=200,json=Mock(return_value=r)) for r in responses]
            result = q.run_agent(source,archive,'gpt-6.1-sol','',api_key='test')
        first = api.call_args_list[0].kwargs['json']['input'][0]['content']
        review = api.call_args_list[-1].kwargs['json']['input'][0]['content']
        expected = [x['data_url'] for x in source['input_images']]
        for content in (first,review):
            self.assertEqual([x['image_url'] for x in content if x['type']=='input_image'], expected)
            manifest = json.loads(content[0]['text'])['request']['image_sources']
            self.assertEqual([x['id'] for x in manifest],['image-request:image:1','image-request:image:2'])
            self.assertNotIn('input_images',json.loads(content[0]['text'])['request'])
        self.assertEqual(result['facts'][-1]['evidence_type'],'image')
        self.assertEqual(result['facts'][-1]['source_filename'],'second.jpg')
        self.assertTrue(result['evidence_check']['safe'])

    def test_visual_review_can_reject_a_false_image_claim(self):
        raw, archive, source = sample()
        result = q.validate_result(raw,source,archive)
        source.update(id='image-request',input_images=[{'filename':'photo.jpg','data_url':'data:image/jpeg;base64,photo'}])
        from unittest.mock import Mock
        verdict = {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"safe":false,"issues":["Artikelnumret syns inte i kundbilden."]}'}]}]}
        with patch.object(q.requests,'post',return_value=Mock(status_code=200,json=Mock(return_value=verdict))):
            q.verify_draft(result,source,archive,'gpt-6.1-sol','test')
        self.assertEqual(result['decision'],'internal_review')
        self.assertFalse(result['quote']['lines'])
        self.assertFalse(result['email']['body'])
        self.assertEqual(result['proposed_email'],raw['email'])
        with self.assertRaises(ValueError): q.build_draft(result)

    def test_filename_does_not_create_an_image_evidence_source(self):
        raw, archive, source = sample()
        raw['facts'].append({'claim':'Bildbevis', 'source_id':'request:image:1','excerpt':'Artikelnummer A1 syns i bilden.'})
        result=q.validate_result(raw,source,archive)
        self.assertEqual(result['decision'],'internal_review')
        self.assertFalse(result['email']['body'])

    def test_live_progress_follows_research_and_draft_validation(self):
        raw, archive, source = sample()
        archive.search = lambda query: [{"id": "gmail:old", "subject": "Offert"}]
        events = []
        responses = [
            {"status": "completed", "output": [{"type": "function_call", "name": "search_history", "call_id": "c1", "arguments": '{"query":"Test Variant"}'}]},
            {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(raw)}]}]}
        ]
        with patch.object(q.requests, 'post') as api, patch.object(q, 'verify_draft') as verify:
            api.return_value.status_code = 200
            api.return_value.json.side_effect = responses
            result = q.run_agent(source, archive, 'gpt-6.1-sol', '', api_key='test', progress=lambda stage, detail: events.append((stage, detail)))
        self.assertEqual(result['decision'], 'quote_draft')
        self.assertIn(('searching', 'Sökningen gav 1 träffar.'), events)
        self.assertEqual(events[-2][0], 'drafting')
        self.assertEqual(events[-1][0], 'verifying')
        verify.assert_called_once()

    def test_search_handles_optional_submission_metadata(self):
        archive=q.Archive(lambda:None,(),lambda:[{"id":"old","fields":{"model":"Uttern D55"},"form_summary":None,"title":None,"timestamp":None}],lambda:[])
        rows=archive.search('Uttern D55')
        self.assertEqual(rows[0]['id'],'submission:old')
        self.assertEqual(rows[0]['date'],'')
    def test_currency_locales(self):
        for value in ("8,604.80", "8.604,80", "8 604,80", "8\u00a0604,80", "8604.80"):
            self.assertEqual(q.money(value), Decimal("8604.80"))
        with self.assertRaises(ValueError): q.money("NaN")

    def test_older_source_allowed_and_integer_rounding(self):
        raw, archive, source = sample()
        result = q.validate_result(raw, source, archive)
        self.assertEqual(result["decision"], "quote_draft")
        self.assertEqual(result["safety_level"], "kolla priset")
        self.assertEqual(result["quote"]["total_sek"], 91)
        self.assertEqual(result["quote"]["rounding_sek"], .46)
        self.assertEqual(result["quote"]["subtotal_ex_vat_sek"], 72.43)
        self.assertEqual(result["customer"]["email"], "current@example.test")

    def test_unknown_source_cannot_create_quote(self):
        raw, archive, source = sample()
        raw["facts"][0]["excerpt"] = "A fabricated unsupported fact"
        result = q.validate_result(raw, source, archive)
        self.assertEqual(result["decision"], "internal_review")
        self.assertFalse(result["quote"]["lines"])
        self.assertFalse(result["email"]["body"])
        self.assertEqual(result['proposed_email'],raw['email'])

    def test_rejected_proposal_is_visible_in_both_internal_formats_without_draft_link(self):
        raw, archive, source = sample()
        raw['facts'][0]['excerpt'] = 'Unsupported evidence'
        result = q.validate_result(raw,source,archive)
        for render in (q.render_test_html,q.render_test_text):
            shown = render(result,'https://example.test/unsafe-draft')
            self.assertIn('Ej godkänt kundförslag',shown)
            self.assertIn('Se bifogad offert!',shown)
            self.assertNotIn('https://example.test/unsafe-draft',shown)

    def test_approved_proposal_keeps_the_outlook_draft(self):
        raw, archive, source = sample()
        result = q.validate_result(raw,source,archive)
        self.assertEqual(result['proposed_email'],result['email'])
        for render in (q.render_test_html,q.render_test_text):
            shown = render(result,'https://example.test/safe-draft')
            self.assertIn('https://example.test/safe-draft',shown)
            self.assertNotIn('Ej godkänt kundförslag',shown)

    def test_variant_question_prevents_quote(self):
        raw, archive, source = sample()
        raw["missing_customer_fields"] = ["Årsmodell?"]
        result = q.validate_result(raw, source, archive)
        self.assertEqual(result["decision"], "ask_customer")
        self.assertFalse(result["quote"]["lines"])

    def test_unverified_pdf_cannot_supply_prices(self):
        raw, archive, source = sample()
        archive.read_assets["pdf:old"]["verified_totals"] = False
        self.assertFalse(q.validate_result(raw, source, archive)["quote"]["lines"])

    def test_partial_invalid_selection_cannot_lower_quote_total(self):
        raw, archive, source = sample()
        raw['quote_rows'].append({'asset_id':'pdf:missing','row_index':0})
        self.assertFalse(q.validate_result(raw, source, archive)['quote']['lines'])

    def test_duplicate_row_is_rejected(self):
        raw, archive, source = sample()
        raw['quote_rows'].append(copy.deepcopy(raw['quote_rows'][0]))
        self.assertFalse(q.validate_result(raw, source, archive)['quote']['lines'])

    def test_pdf_line_wrapping_preserves_verifiable_quote(self):
        raw, archive, source = sample()
        archive.read_sources['gmail:old']['text']='Originalkapell för exakt\nvariant 2007'
        self.assertEqual(q.validate_result(raw, source, archive)['decision'],'quote_draft')

    def test_draft_is_unsent_and_contains_attachment(self):
        raw, archive, source = sample()
        result = q.validate_result(raw, source, archive)
        message = BytesParser(policy=policy.default).parsebytes(q.build_draft(result, b"%PDF-test", "archive@example.test"))
        self.assertEqual(message["X-Unsent"], "1")
        self.assertEqual(message["To"], "current@example.test")
        self.assertEqual(len(list(message.iter_attachments())), 1)

    def test_pdf_formats_are_verified_against_totals(self):
        import fitz
        doc = fitz.open(); page = doc.new_page()
        columns = [(45,"Art.nr"),(120,"Beskrivning"),(285,"Antal"),(320,"Enhet"),(398,"A-pris"),(455,"Rabatt"),(513,"Summa")]
        for x, text in columns: page.insert_text((x,100),text,fontsize=8)
        for x, text in [(45,"A1"),(120,"Test variant"),(285,"1,00"),(320,"st"),(386,"8,604.80"),(450,"10,00%"),(513,"7,744.32")]:
            if x in (386,450,513):
                hx, label={386:(398,"A-pris"),450:(455,"Rabatt"),513:(513,"Summa")}[x]
                right=hx+fitz.get_text_length(label,fontsize=8)
                page.insert_text((right-fitz.get_text_length(text,fontsize=8),125),text,fontsize=8)
            else: page.insert_text((x,125),text,fontsize=8)
        for y,label,value in [(700,"Exkl. moms","6,195.46"),(720,"Moms (25 %)","1,548.86"),(740,"Totalbelopp","7,744.32")]:
            page.insert_text((45,y),label,fontsize=8);page.insert_text((240,y),value,fontsize=8)
        data=q.extract_pdf(doc.tobytes()); doc.close()
        self.assertTrue(data["verified_totals"])
        self.assertEqual(data["lines"][0]["unit_price_sek"],8604.80)


class AdminTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.app.test_client()
        cls.headers = {"X-Admin-Key": "quote-agent-test-key"}
        db = app.get_db()
        db.merge(app.FormSubmission(id="unit-request",form_type="Kontakt",fields={"email":"current@example.test"},title="Test"))
        db.commit(); db.close()

    def test_private_endpoints_require_authentication(self):
        for url in ("/api/quote_agent/status","/api/quote_agent/feedback","/api/quote_agent/submission/unit-request/pdf","/api/quote_agent/submission/unit-request"):
            self.assertIn(self.client.get(url).status_code,(401,403))
        self.assertEqual(self.client.get('/api/quote_agent/draft?id=unit-request&ts=1&token=bad').status_code,403)

    def test_rejected_proposal_survives_api_and_feedback_but_cannot_be_downloaded_as_draft(self):
        raw, archive, source = sample()
        raw['facts'][0]['excerpt'] = 'Unsupported evidence'
        result = q.validate_result(raw,source,archive)
        id = 'rejected-proposal'
        db = app.get_db()
        db.add(app.FormSubmission(id=id,form_type='Kontakt',fields={'email':'current@example.test'}))
        db.add(app.QuoteRun(id=id,result=result))
        db.commit(); db.close()
        data = self.client.get('/api/quote_agent/submission/'+id,headers=self.headers).json
        self.assertEqual(data['result']['proposed_email'],raw['email'])
        self.assertEqual(data['draft_url'],'')
        signed_url = app.get_quote_agent_draft_url(id)
        from urllib.parse import urlsplit
        url = urlsplit(signed_url)
        self.assertEqual(self.client.get(url.path+'?'+url.query).status_code,409)
        response = self.client.post('/api/quote_agent/feedback',headers=self.headers,json={'submission_id':id,'text':'Kontrollera bildpåståendet först.','scope':'global'})
        self.assertEqual(response.status_code,200)
        db = app.get_db()
        feedback = db.get(app.QuoteAgentFeedback,response.json['id'])
        self.assertEqual(feedback.context['previous_email'],raw['email'])
        db.close()

    def test_job_continues_without_original_view_and_reports_persisted_progress(self):
        id = 'background-progress'
        db = app.get_db()
        db.add(app.FormSubmission(id=id,form_type='Kontakt',fields={'email':'current@example.test'}))
        db.commit(); db.close()
        entered, release = threading.Event(), threading.Event()
        def worker(source, attachments=None, progress=None):
            progress('searching', 'Söker efter modell och variant.')
            entered.set()
            if not release.wait(5): raise RuntimeError('Test timeout')
            progress('verifying', 'Granskar källorna.')
            return {'result':q.blocked_result('Behöver Niclas'), 'trace':[]}
        path = '/api/quote_agent/submission/'+id
        with patch.object(app,'run_ai_lab_agent',side_effect=worker) as agent, patch.object(app,'send_mailgun_email') as send:
            try:
                self.assertEqual(self.client.post(path,headers=self.headers,json={}).status_code,200)
                self.assertTrue(entered.wait(3))
                another_view = app.app.test_client()
                data = another_view.get(path,headers=self.headers).json
                self.assertEqual(data['state'],'running')
                self.assertEqual(data['progress']['stage'],'searching')
                another_view.post(path,headers=self.headers,json={'regenerate':True})
            finally:
                release.set()
            for _ in range(60):
                data = another_view.get(path,headers=self.headers).json
                if data['state']=='completed': break
                time.sleep(.02)
            self.assertEqual(data['state'],'completed')
            self.assertEqual(data['progress']['stage'],'completed')
            self.assertEqual(data['progress']['events'][0]['stage'],'reading')
            self.assertIn('verifying',[e['stage'] for e in data['progress']['events']])
            self.assertEqual(agent.call_count,1)
            send.assert_not_called()

    def test_older_worker_cannot_replace_current_progress(self):
        id = 'progress-token-test'
        db = app.get_db()
        db.add(app.QuoteAgentJob(id=id,state='running',token='new'))
        db.commit(); db.close()
        app.update_quote_agent_progress(id,'new','searching','Ny körning')
        app.update_quote_agent_progress(id,'old','pdf','Gammal körning')
        db = app.get_db()
        status = db.get(app.QuoteAgentProgress,id)
        self.assertEqual(status.token,'new')
        self.assertEqual(status.data['detail'],'Ny körning')
        db.close()

    def test_feedback_persists_and_can_be_removed(self):
        response = self.client.post('/api/quote_agent/feedback',headers=self.headers,json={"submission_id":"unit-request","text":"Fråga om bågarna är original.","scope":"global"})
        self.assertEqual(response.status_code,200)
        id = response.json["id"]
        self.assertIn(id,[r["id"] for r in app.load_quote_agent_feedback()])
        self.client.delete('/api/quote_agent/feedback/'+id,headers=self.headers)
        self.assertNotIn(id,[r["id"] for r in app.load_quote_agent_feedback()])

    def test_every_run_reads_current_feedback_and_requested_model(self):
        with patch.object(app.quote_agent,'run_agent',return_value=q.blocked_result('Test')) as agent, patch.object(app,'load_quote_agent_feedback',return_value=[{"id":"memory1","text":"Remember"}]):
            app.run_ai_lab_agent({"id":"unit-request","fields":{},"kind":"manual"})
        self.assertEqual(agent.call_args.args[2],"gpt-6.1-sol")
        self.assertEqual(agent.call_args.kwargs['feedback'][0]['id'],'memory1')

    def test_stored_submission_images_are_loaded_into_the_agent(self):
        from io import BytesIO
        from PIL import Image
        data=BytesIO();Image.new('RGB',(2100,1000),'blue').save(data,format='JPEG')
        db=app.get_db()
        db.add(app.SubmissionAttachment(submission_id='unit-request',filename='customer.jpg',mime='image/jpeg',data=data.getvalue()))
        db.commit();db.close()
        images,docs=app.quote_agent_request_attachments({'kind':'submission','id':'unit-request'})
        self.assertEqual(len(images),1)
        self.assertEqual(images[0]['filename'],'customer.jpg')
        self.assertTrue(images[0]['data_url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(docs,[])

    def test_cached_result_does_not_rerun_or_send(self):
        submission = {"id":"unit-request","fields":{"email":"current@example.test"}}
        with patch.object(app,'run_ai_lab_agent',return_value={"result":q.blocked_result('Test'),"trace":[]}) as agent, patch.object(app,'send_mailgun_email') as send:
            app.get_or_create_quote_agent_result(submission)
            app.get_or_create_quote_agent_result(submission)
        self.assertEqual(agent.call_count,1)
        send.assert_not_called()

    def test_internal_notification_contains_agent_box_and_only_internal_recipient(self):
        raw, archive, source = sample()
        result = q.validate_result(raw, source, archive)
        db = app.get_db()
        db.merge(app.QuoteRun(id='unit-request',result=result,quote_pdf=b'%PDF-test'))
        db.commit(); db.close()
        with patch.object(app,'get_or_create_quote_agent_result',return_value=result), patch.object(app,'get_submission_notification_recipients',return_value=['internal@example.test']), patch.object(app,'send_mailgun_email',return_value=(True,'ok')) as send:
            app.send_mailgun_submission_notification({'id':'unit-request','form_type':'Kontakt','fields':source['fields']})
        self.assertEqual(send.call_args.kwargs['recipients'],['internal@example.test'])
        self.assertIn('Agent Test',send.call_args.kwargs['html_body'])
        self.assertIn('AgentTest-Offertutkast.pdf',[v[0] for v in send.call_args.kwargs['regular_attachments']])


def tearDownModule():
    app.engine.dispose()
    TEMP.cleanup()


if __name__ == '__main__': unittest.main()
